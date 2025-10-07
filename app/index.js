import express from "express";
import admin from "firebase-admin";
import { getDatabase } from "firebase-admin/database";

// Ensure Firebase is initialized once
if (!admin.apps.length) {
  const serviceAccount = await import("/etc/secrets/serviceAccount.json", {
    assert: { type: "json" },
  });
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount.default),
    databaseURL: "https://stock-grow-a-garden-default-rtdb.firebaseio.com/",
  });
}

const db = getDatabase();
const router = express.Router();

/**
 * GET /app/search?q=starship&uid=12345&limit=25
 */
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
