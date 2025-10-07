import express from "express";
import WebSocket from "ws";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sendNotification } from "./sendNotification.js";
import { saveToken } from "./registerToken.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Firebase Admin SDK setup
import serviceAccount from "/etc/secrets/serviceAccount.json" assert { type: "json" };
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://stock-grow-a-garden-default-rtdb.firebaseio.com/",
  });
}
const db = admin.database();

// --- Register Token ---
router.post("/registerToken", async (req, res) => {
  const fcmToken = req.body.token;
  if (!fcmToken) return res.status(400).send("Missing FCM token");

  try {
    await saveToken(db, fcmToken);
    res.status(200).send("✅ Token registered successfully.");
  } catch (err) {
    console.error("❌ Error saving token:", err);
    res.status(500).send("Failed to register token.");
  }
});

// --- Subscribe / Unsubscribe ---
router.post("/subscribe", async (req, res) => {
  const { fcmToken, category, items } = req.body;
  if (!fcmToken || !category || !Array.isArray(items)) {
    return res.status(400).send("Missing fcmToken, category, or items array");
  }

  try {
    const updates = {};
    items.forEach((item) => (updates[`subscriptions/${fcmToken}/${category}/${item}`] = true));
    await db.ref().update(updates);
    res.status(200).send(`✅ Subscribed to ${items.join(", ")} under ${category}`);
  } catch (err) {
    console.error("❌ Error subscribing:", err);
    res.status(500).send("Failed to subscribe");
  }
});

router.post("/unsubscribe", async (req, res) => {
  const { fcmToken, category, items } = req.body;
  if (!fcmToken || !category || !Array.isArray(items)) {
    return res.status(400).send("Missing fcmToken, category, or items array");
  }

  try {
    const updates = {};
    items.forEach((item) => (updates[`subscriptions/${fcmToken}/${category}/${item}`] = null));
    await db.ref().update(updates);
    res.status(200).send(`✅ Unsubscribed from ${items.join(", ")} under ${category}`);
  } catch (err) {
    console.error("❌ Error unsubscribing:", err);
    res.status(500).send("Failed to unsubscribe");
  }
});

// --- Subscriptions ---
router.get("/subscriptions/:fcmToken", async (req, res) => {
  try {
    const snapshot = await db.ref(`subscriptions/${req.params.fcmToken}`).once("value");
    res.status(200).json(snapshot.val() || {});
  } catch (err) {
    console.error("❌ Error fetching subscriptions:", err);
    res.status(500).send("Failed to get subscriptions");
  }
});

// --- Cached stock ---
router.get("/stock", (req, res) => {
  const cachePath = path.join(__dirname, "../cache/latest-stock.json");
  const categoryParam = req.query.category;

  try {
    if (!fs.existsSync(cachePath)) return res.status(200).json({});
    const stock = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    if (categoryParam) return res.status(200).json(stock[categoryParam] || {});
    res.status(200).json(stock);
  } catch (err) {
    console.error("❌ Error reading stock cache:", err);
    res.status(500).send("Failed to read stock cache");
  }
});

router.get("/ping", (req, res) => res.status(200).send("✅ Grow A Garden API is awake!"));

// --- WebSocket listener ---
const WS_USER_ID = "grow_notifier_backend";
const JSTUDIO_KEY = "js_b01b4c1ef8cb9bf91a38b77b831d07ae31779f21636fecae1d1db17f0254c536";
const wsUrl = `wss://websocket.joshlei.com/growagarden?user_id=${encodeURIComponent(
  WS_USER_ID
)}&jstudio-key=${JSTUDIO_KEY}`;

let ws;
function connectWebSocket() {
  ws = new WebSocket(wsUrl);

  ws.on("open", () => console.log("✅ Grow A Garden WebSocket connected."));
  ws.on("close", () => {
    console.warn("⚠️ WebSocket closed. Reconnecting in 5s...");
    setTimeout(connectWebSocket, 5000);
  });
  ws.on("error", (err) => console.error("❌ WebSocket error:", err));

  ws.on("message", async (data) => {
    console.log("📦 Raw stock update:\n", data.toString());
    try {
      const parsed = JSON.parse(data.toString());
      const [category, itemsArray] = Object.entries(parsed)[0];
      if (!category || !Array.isArray(itemsArray)) return;

      const cacheDir = path.join(__dirname, "../cache");
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
      const cachePath = path.join(cacheDir, "latest-stock.json");

      let stockCache = {};
      if (fs.existsSync(cachePath)) stockCache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));

      const transformed = {};
      for (const item of itemsArray) if (item?.item_id) transformed[item.item_id] = item;
      stockCache[category] = transformed;
      fs.writeFileSync(cachePath, JSON.stringify(stockCache, null, 2));
      console.log(`💾 Stock cache updated for '${category}'.`);

      // Notify subscribers
      for (const itemId of Object.keys(transformed)) {
        const tokensSnap = await db.ref(`subscriptions/${category}/${itemId}`).once("value");
        const tokens = tokensSnap.val() || {};
        const allTokens = Object.keys(tokens);
        if (!allTokens.length) continue;

        const payload = {
          title: `🔔 ${itemId.replace("_", " ")} restocked!`,
          body: `Check the ${category} category now!`,
          data: { stock: `${category}/${itemId}` },
        };
        for (const token of allTokens) await sendNotification(admin, token, payload);
      }
    } catch (err) {
      console.error("❌ Error processing stock update:", err);
    }
  });
}
connectWebSocket();

export default router;
