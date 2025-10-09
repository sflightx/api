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

const router = express.Router();