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
    // Fetch all data in parallel
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

    // 🔍 Search results
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

export default router;
