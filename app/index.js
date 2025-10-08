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

/* ============================================================
   🟢 GET: Fetch blueprint details
   ============================================================ */
router.get("/blueprint/:postKey", async (req, res) => {
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
🔍 GET: Search blueprints
============================================================ */

router.get("/search", async (req, res) => {
  try {
    const query = (typeof req.query.q === "string" ? req.query.q : "").trim().toLowerCase();
    const uid = typeof req.query.uid === "string" ? req.query.uid : undefined;
    const limit = parseInt(req.query.limit ? req.query.limit.toString() : "") || 25;

    if (!query) {
      return res.status(400).json({ error: "Missing search query" });
    }

    const ref = db.ref("upload/blueprint");
    const snapshot = await ref.get();

    const rootSnap = await db.ref().get();
    console.log("Root keys in database:", Object.keys(rootSnap.val() || {}));


    if (!snapshot.exists()) {
      console.log("No blueprints found in database.");
      return res.json({ query, results: { search: [], personalized: [], trending: [], recent: [] } });
    }

    const allBlueprints = snapshot.val();

    const normalize = (id, data) => ({
      id,
      authorId: data.authorId || "",
      name: data.name || "",
      desc: data.desc || "",
      image_url: data.image_url || "",
      downloads: data.downloads || 0,
      like: data.like || 0,
      dislike: data.dislike || 0,
      timestamp: data.timestamp || 0,
      key: data.key || "",
    });

    const searchResults = [];
    for (const [id, data] of Object.entries(allBlueprints)) {
      const name = data.name || "";
      const desc = data.desc || "";
      const searchField = data.search || "";

      const combined = `${name} ${desc} ${searchField}`.toLowerCase();
      const isMatch = combined.includes(query);

      console.log(`[DEBUG] Checking blueprint ID: ${id}`);
      console.log(`       Name: "${name}"`);
      console.log(`       Desc: "${desc}"`);
      console.log(`       Search field: "${searchField}"`);
      console.log(`       Match: ${isMatch}`);

      if (isMatch) {
        searchResults.push(normalize(id, data));
      }
    }

    console.log(`[DEBUG] Total search results: ${searchResults.length}`);

    // 👥 Personalized results
    let personalizedResults = [];
    if (uid) {
      try {
        const followSnap = await db.ref(`userdata/${uid}/following`).get();
        if (followSnap.exists()) {
          const followedIds = Object.keys(followSnap.val());
          personalizedResults = Object.entries(allBlueprints)
            .filter(([_, d]) => followedIds.includes(d.authorId))
            .map(([id, d]) => normalize(id, d));
        }
      } catch (e) {
        console.warn("Personalization skipped:", e);
      }
    }

    // 🔥 Trending
    const trending = Object.entries(allBlueprints)
      .map(([id, d]) => normalize(id, d))
      .sort((a, b) => (b.like + b.downloads) - (a.like + a.downloads))
      .slice(0, 10);

    // 🕓 Recent
    const recent = Object.entries(allBlueprints)
      .map(([id, d]) => normalize(id, d))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);

    res.json({
      query,
      total: searchResults.length,
      results: {
        search: searchResults.slice(0, limit),
        personalized: personalizedResults.slice(0, 10),
        trending,
        recent,
      },
    });
  } catch (error) {
    console.error("Search API Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ============================================================
   🔴 DELETE: Remove a specific blueprint and related data
   ============================================================ */
router.delete("/blueprint/:postKey", async (req, res) => {
  const postKey = req.params.postKey;
  console.log("🔍 DELETE request for postKey:", req.params.postKey);

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing or invalid token" });
  }

  const idToken = authHeader.split("Bearer ")[1];

  try {
    // Verify the Firebase Auth token
    const decoded = await admin.auth().verifyIdToken(idToken);
    const requestUid = decoded.uid;

    // Fetch blueprint data
    const blueprintRef = db.ref(`upload/blueprint/${postKey}`);
    const blueprintSnap = await blueprintRef.get();

    if (!blueprintSnap.exists()) {
      return res.status(404).json({ error: "Blueprint not found" });
    }

    const blueprintData = blueprintSnap.val();
    const authorId = blueprintData.authorId;
    const imageUrl = blueprintData.image_url;

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
