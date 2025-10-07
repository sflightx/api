import express from "express";
import WebSocket from "ws";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sendNotification } from "../task/sendNotification.js";
import { saveToken } from "../task/registerToken.js";

// --- Resolve __dirname (not available in ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Firebase Admin SDK setup
const serviceAccount = JSON.parse(fs.readFileSync("/etc/secrets/serviceAccount_gag.json", "utf-8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://stock-grow-a-garden-default-rtdb.firebaseio.com/"
});

const db = admin.database();
const router = express.Router();

// --- Register Token
router.post("/registerToken", async (req, res) => {
  const fcmToken = req.body.token;
  if (!fcmToken) return res.status(400).send("Missing FCM token");

  try {
    await saveToken(db, fcmToken);
    res.status(200).send("✅ Token registered successfully.");
  } catch (error) {
    console.error("❌ Error saving token:", error);
    res.status(500).send("Failed to register token.");
  }
});

// --- Subscribe
router.post("/subscribe", async (req, res) => {
  const { fcmToken, category, items } = req.body;

  if (!fcmToken || !category || !Array.isArray(items)) {
    return res.status(400).send("Missing fcmToken, category, or items array");
  }

  try {
    const updates = {};
    items.forEach(item => {
      updates[`subscriptions/${fcmToken}/${category}/${item}`] = true;
    });

    await db.ref().update(updates);
    res.status(200).send(`✅ Subscribed to ${items.join(", ")} under ${category}`);
  } catch (error) {
    console.error("❌ Error subscribing:", error);
    res.status(500).send("Failed to subscribe");
  }
});

// --- Unsubscribe
router.post("/unsubscribe", async (req, res) => {
  const { fcmToken, category, items } = req.body;

  if (!fcmToken || !category || !Array.isArray(items)) {
    return res.status(400).send("Missing fcmToken, category, or items array");
  }

  try {
    const updates = {};
    items.forEach(item => {
      updates[`subscriptions/${fcmToken}/${category}/${item}`] = null;
    });

    await db.ref().update(updates);
    res.status(200).send(`✅ Unsubscribed from ${items.join(", ")} under ${category}`);
  } catch (error) {
    console.error("❌ Error unsubscribing:", error);
    res.status(500).send("Failed to unsubscribe");
  }
});

// --- Get Subscriptions
router.get("/subscriptions/:fcmToken", async (req, res) => {
  const fcmToken = req.params.fcmToken;

  try {
    const snapshot = await db.ref(`subscriptions/${fcmToken}`).once("value");
    const data = snapshot.val() || {};
    res.status(200).json(data);
  } catch (error) {
    console.error("❌ Error fetching subscriptions:", error);
    res.status(500).send("Failed to get subscriptions");
  }
});

// --- Get Stock
router.get("/stock", (req, res) => {
  const cachePath = path.join(__dirname, "../cache/latest-stock.json");
  const categoryParam = req.query.category;

  try {
    if (!fs.existsSync(cachePath)) {
      return res.status(200).json({});
    }

    const data = fs.readFileSync(cachePath, "utf-8");
    const stock = JSON.parse(data);

    if (categoryParam) {
      const categoryData = stock[categoryParam];
      return res.status(200).json(categoryData || {});
    }

    res.status(200).json(stock);
  } catch (err) {
    console.error("❌ Error reading stock cache:", err);
    res.status(500).send("Failed to read stock cache");
  }
});

// --- Dummy Ping
router.get("/ping", (req, res) => {
  res.status(200).send("✅ Grow A Garden API is awake!");
});

// --- WebSocket
const WS_USER_ID = "grow_notifier_backend";
const JSTUDIO_KEY = "js_b01b4c1ef8cb9bf91a38b77b831d07ae31779f21636fecae1d1db17f0254c536";
const wsUrl = `wss://websocket.joshlei.com/growagarden?user_id=${encodeURIComponent(
  WS_USER_ID
)}&jstudio-key=${JSTUDIO_KEY}`;
let ws;
let reconnectInterval = 5000;

function connectWebSocket() {
  ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log("✅ Grow A Garden WebSocket connected.");
  });

  ws.on("message", async (data) => {
    console.log("📦 Raw stock update received:\n", data.toString());

    try {
      const parsed = JSON.parse(data.toString());
      const [category, itemsArray] = Object.entries(parsed)[0];

      if (!category || !Array.isArray(itemsArray)) {
        console.warn("⚠️ Invalid stock update format");
        return;
      }

      const cacheDir = path.join(__dirname, "../cache");
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      const cachePath = path.join(cacheDir, "latest-stock.json");

      let stockCache = {};
      try {
        if (fs.existsSync(cachePath)) {
          stockCache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
        }
      } catch (readErr) {
        console.warn("⚠️ Failed to read existing stock cache:", readErr);
      }

      const transformed = {};
      for (const item of itemsArray) {
        if (item?.item_id) {
          transformed[item.item_id] = item;
        }
      }

      console.log(`🆕 Parsed new items for category '${category}':`, transformed);

      stockCache[category] = transformed;

      fs.writeFileSync(cachePath, JSON.stringify(stockCache, null, 2));
      console.log(
        `💾 Stock cache updated for '${category}' with ${Object.keys(transformed).length} items.`
      );

      console.log("🗂 Final saved stock cache:\n", JSON.stringify(stockCache, null, 2));

      for (const itemId of Object.keys(transformed)) {
        const tokensSnapshot = await db.ref(`subscriptions/${category}/${itemId}`).once("value");
        const tokens = tokensSnapshot.val() || {};
        const allTokens = Object.keys(tokens);

        if (allTokens.length === 0) continue;

        console.log(`🔔 Notifying ${allTokens.length} users for ${category} > ${itemId}`);

        const payload = {
          title: `🔔 ${itemId.replace("_", " ")} restocked!`,
          body: `Check the ${category} category now!`,
          data: { stock: `${category}/${itemId}` }
        };

        for (const token of allTokens) {
          await sendNotification(admin, token, payload);
        }
      }
    } catch (err) {
      console.error("❌ Error processing stock update:", err);
    }
  });

  ws.on("close", () => {
    console.warn(`⚠️ WebSocket closed. Reconnecting in ${reconnectInterval / 1000}s...`);
    setTimeout(connectWebSocket, reconnectInterval);
  });

  ws.on("error", (err) => {
    console.error("❌ WebSocket error:", err);
  });
}

connectWebSocket();

export default router;