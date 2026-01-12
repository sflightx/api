import express from "express";
import admin from "firebase-admin";
import { getDatabase } from "firebase-admin/database";
import fs from "fs";

// Load JSON manually instead of dynamic `import()`
const sflightxServiceAccount = JSON.parse(
  fs.readFileSync("/etc/secrets/serviceAccount_sflightx.json", "utf-8")
);

let sflightxApp;

// Initialize named Firebase app if not exists
if (!admin.apps.some((a) => a.name === "sflightxApp")) {
  sflightxApp = admin.initializeApp(
    {
      credential: admin.credential.cert(sflightxServiceAccount),
      databaseURL: "https://sflight-x-default-rtdb.firebaseio.com/",
    },
    "sflightxApp"
  );
} else {
  sflightxApp = admin.app("sflightxApp");
}

const db = getDatabase(sflightxApp);
const router = express.Router();

router.get("/:postKey", async (req, res) => {
  const postKey = req.params.postKey;

  try {
    const [dataSnap, commentsSnap, likesSnap, dislikesSnap] = await Promise.all([
      db.ref(`upload/blueprint/${postKey}`).get(),
      db.ref(`comment/upload/blueprint/${postKey}`).get(),
      db.ref(`upload/likes/${postKey}`).get(),
      db.ref(`upload/dislikes/${postKey}`).get(),
    ]);

    const blueprintData = dataSnap.exists() ? dataSnap.val() : null;
    const comments = commentsSnap.exists() ? Object.values(commentsSnap.val()) : [];
    const likes = likesSnap.exists() ? Object.keys(likesSnap.val()) : [];
    const dislikes = dislikesSnap.exists() ? Object.keys(dislikesSnap.val()) : [];

    res.json({
      data: blueprintData,
      comments,
      likes,
      dislikes,
    });
  } catch (error) {
    console.error("Blueprint details API Error:", error);
    res.status(500).json({ error: "Failed to fetch blueprint details" });
  }
});

// Change the route to include :key parameter to match your Android URL
router.post("/:key", async (req, res) => {
  const authHeader = req.headers.authorization;
  const urlKey = req.params.key; // Captured from /blueprint/:key

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing or invalid token" });
  }

  const idToken = authHeader.split("Bearer ")[1];

  try {
    // 1. Verify the Firebase Token
    const decoded = await sflightxApp.auth().verifyIdToken(idToken);
    const userId = decoded.uid;

    // 2. Extract data from body (matching the map sent from Android)
    const {
      name,
      file_link,
      desc,
      downloads,
      image_url,
      req_game,
      req_type
    } = req.body;

    // Use urlKey if key is not provided in body
    const finalKey = req.body.key || urlKey;

    // 3. Validation
    if (!name || !file_link || !finalKey) {
      return res.status(400).json({ error: "Missing required fields: name, file_link, or key" });
    }

    // 4. Prepare the data object
    const blueprintData = {
      name,
      file_link,
      desc: desc || "",
      timestamp: admin.database.ServerValue.TIMESTAMP, // Use server-side timestamp for accuracy
      downloads: downloads || 0,
      author: userId,
      image_url: image_url || "",
      req_game: req_game || "Unknown",
      req_type: req_type || "Other",
      key: finalKey,
    };

    // 5. Atomic Update: Write to both the global feed and the user's personal list
    const updates = {};
    updates[`upload/blueprint/${finalKey}`] = blueprintData;
    updates[`userdata/${userId}/upload/${finalKey}`] = blueprintData;

    await db.ref().update(updates);

    // 6. Return Success
    res.json({
      success: true,
      message: "Blueprint created successfully",
      key: finalKey
    });

  } catch (error) {
    console.error("❌ Post blueprint API Error:", error);

    // Distinguish between Auth errors and Database errors
    if (error.code?.startsWith('auth/')) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    res.status(500).json({ error: "Internal server error" });
  }
});

/* ============================================================
   🔴 DELETE: Remove a specific blueprint and related data
   ============================================================ */
router.delete("/:postKey", async (req, res) => {
  const postKey = req.params.postKey;
  console.log("🔍 DELETE request for postKey:", req.params.postKey);

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing or invalid token" });
  }

  const idToken = authHeader.split("Bearer ")[1];

  if (!idToken) {
    return res.status(401).json({ error: "Unauthorized: Token not provided" });
  }

  try {
    // Verify the Firebase Auth token
    const decoded = await sflightxApp.auth().verifyIdToken(idToken);
    const requestUid = decoded.uid;

    // Fetch blueprint data
    const blueprintRef = db.ref(`upload/blueprint/${postKey}`);
    const blueprintSnap = await blueprintRef.get();

    if (!blueprintSnap.exists()) {
      return res.status(404).json({ error: "Blueprint not found" });
    }

    const blueprintData = blueprintSnap.val();
    const authorId = blueprintData.author;
    const imageUrl = blueprintData.image_url;

    console.log("Blueprint authorId:", authorId);
    console.log("Request user UID:", requestUid);


    // 🔒 Check ownership
    if (authorId !== requestUid) {
      return res.status(403).json({ error: "Forbidden: You do not own this blueprint" });
    }

    // Build deletion updates
    const updates = {};
    updates[`upload/blueprint/${postKey}`] = null;
    updates[`userdata/${authorId}/upload/${postKey}`] = null;
    updates[`comment/upload/blueprint/${postKey}`] = null;
    updates[`upload/likes/${postKey}`] = null;
    updates[`upload/dislikes/${postKey}`] = null;

    // Apply all deletions
    await db.ref().update(updates);

    // Delete image if applicable
    if (imageUrl && imageUrl.includes("firebasestorage.googleapis.com")) {
      try {
        const storage = admin.storage();
        const bucket = storage.bucket();
        const pathStart = imageUrl.indexOf("/o/") + 3;
        const pathEnd = imageUrl.indexOf("?alt=");
        const encodedPath = imageUrl.substring(pathStart, pathEnd);
        const filePath = decodeURIComponent(encodedPath);

        await bucket.file(filePath).delete();
        console.log(`✅ Deleted image: ${filePath}`);
      } catch (err) {
        console.warn("⚠️ Failed to delete image:", err.message);
      }
    }

    res.json({
      success: true,
      message: `Blueprint ${postKey} deleted successfully.`,
    });
  } catch (error) {
    console.error("❌ Delete blueprint API Error:", error);
    if (error.code === "auth/argument-error" || error.errorInfo?.code === "auth/invalid-id-token") {
      return res.status(401).json({ error: "Invalid authentication token" });
    }
    res.status(500).json({ error: "Failed to delete blueprint" });
  }
});
export default router;