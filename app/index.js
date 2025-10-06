import express from "express";
import { getDatabase } from "firebase-admin/database";

const router = express.Router();
const db = getDatabase();

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

    // --- 🔍 SEARCH RESULTS ---
    const searchResults = [];
    for (const [id, data] of Object.entries(allBlueprints)) {
      if ((data.name || "").toLowerCase().includes(query)) {
        searchResults.push(normalize(id, data));
      }
    }

    // --- 👥 PERSONALIZED (from followed authors) ---
    let personalizedResults = [];
    if (uid) {
      try {
        const followRef = db.ref(`userdata/${uid}/following`);
        const followSnap = await followRef.get();

        if (followSnap.exists()) {
          const followedIds = Object.keys(followSnap.val());
          for (const [id, data] of Object.entries(allBlueprints)) {
            if (followedIds.includes(data.authorId)) {
              personalizedResults.push(normalize(id, data));
            }
          }
        }
      } catch (err) {
        console.warn("Personalization skipped:", err);
      }
    }

    // --- 🔥 TRENDING (based on likes + downloads) ---
    const trending = Object.entries(allBlueprints)
      .map(([id, data]) => normalize(id, data))
      .sort((a, b) => (b.like + b.downloads) - (a.like + a.downloads))
      .slice(0, 10);

    // --- 🕓 RECENT (latest uploads) ---
    const recent = Object.entries(allBlueprints)
      .map(([id, data]) => normalize(id, data))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);

    // --- 📦 FINAL RESPONSE ---
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

module.exports = router;