const express = require('express');
const router = express.Router();
const WebSocket = require('ws');
const admin = require('firebase-admin');
const { sendNotification } = require('../functions/sendNotification');
const { saveToken } = require('../functions/registerToken');
const fs = require('fs');
const path = require('path');

// Firebase Admin SDK setup
const serviceAccount = require('/etc/secrets/serviceAccount.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://stock-grow-a-garden-default-rtdb.firebaseio.com/' // Replace
});
const db = admin.database();

// API endpoint to register token
router.post('/registerToken', async (req, res) => {
  const fcmToken = req.body.token;
  if (!fcmToken) return res.status(400).send('Missing FCM token');

  try {
    await saveToken(db, fcmToken); // Pass db instance
    res.status(200).send('✅ Token registered successfully.');
  } catch (error) {
    console.error('❌ Error saving token:', error);
    res.status(500).send('Failed to register token.');
  }
});

// Subscribe to a list of items under a category
router.post('/subscribe', async (req, res) => {
  const { fcmToken, category, items } = req.body;

  if (!fcmToken || !category || !Array.isArray(items)) {
    return res.status(400).send('Missing fcmToken, category, or items array');
  }

  try {
    const updates = {};
    items.forEach(item => {
      updates[`subscriptions/${fcmToken}/${category}/${item}`] = true;
    });

    await db.ref().update(updates);
    res.status(200).send(`✅ Subscribed to ${items.join(', ')} under ${category}`);
  } catch (error) {
    console.error('❌ Error subscribing:', error);
    res.status(500).send('Failed to subscribe');
  }
});

// Unsubscribe from a list of items under a category
router.post('/unsubscribe', async (req, res) => {
  const { fcmToken, category, items } = req.body;

  if (!fcmToken || !category || !Array.isArray(items)) {
    return res.status(400).send('Missing fcmToken, category, or items array');
  }

  try {
    const updates = {};
    items.forEach(item => {
      updates[`subscriptions/${fcmToken}/${category}/${item}`] = null;
    });

    await db.ref().update(updates);
    res.status(200).send(`✅ Unsubscribed from ${items.join(', ')} under ${category}`);
  } catch (error) {
    console.error('❌ Error unsubscribing:', error);
    res.status(500).send('Failed to unsubscribe');
  }
});

// Get all subscriptions for a token
router.get('/subscriptions/:fcmToken', async (req, res) => {
  const fcmToken = req.params.fcmToken;

  try {
    const snapshot = await db.ref(`subscriptions/${fcmToken}`).once('value');
    const data = snapshot.val() || {};
    res.status(200).json(data);
  } catch (error) {
    console.error('❌ Error fetching subscriptions:', error);
    res.status(500).send('Failed to get subscriptions');
  }
});

router.get('/stock', (req, res) => {
  const cachePath = path.join(__dirname, '../cache/latest-stock.json');
  try {
    if (!fs.existsSync(cachePath)) {
      return res.status(200).json({});
    }

    const data = fs.readFileSync(cachePath, 'utf-8');
    res.status(200).json(JSON.parse(data));
  } catch (err) {
    console.error('❌ Error reading stock cache:', err);
    res.status(500).send('Failed to read stock cache');
  }
});



// Dummy ping endpoint
router.get('/ping', (req, res) => {
  res.status(200).send('✅ Grow A Garden API is awake!');
});

// Grow A Garden WebSocket
const WS_USER_ID = 'grow_notifier_backend';
const wsUrl = `wss://websocket.joshlei.com/growagarden?user_id=${encodeURIComponent(WS_USER_ID)}`;
let ws;
let reconnectInterval = 5000;

function connectWebSocket() {
  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('✅ Grow A Garden WebSocket connected.');
  });

  ws.on('message', async (data) => {
    console.log('📦 Stock update received:', data.toString());

    try {
      const { category, item } = JSON.parse(data.toString());

      const cacheDir = path.join(__dirname, '../cache');
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      // Read existing stock cache
      const cachePath = path.join(__dirname, '../cache/latest-stock.json');
      let stockCache = {};
      try {
        if (fs.existsSync(cachePath)) {
          const file = fs.readFileSync(cachePath, 'utf-8');
          stockCache = JSON.parse(file);
        }
      } catch (readErr) {
        console.warn('⚠️ Failed to read stock cache:', readErr);
      }

      // Update stock
      if (!stockCache[category]) stockCache[category] = {};
      stockCache[category][item] = {
        timestamp: Date.now(),
        category,
        item
      };

      // Save to file
      fs.writeFileSync(cachePath, JSON.stringify(stockCache, null, 2));
      console.log('💾 Stock cache updated.');

      // Notify subscribed users
      const tokensSnapshot = await db.ref(`subscriptions/${category}/${item}`).once('value');
      const tokens = tokensSnapshot.val() || {};
      const allTokens = Object.keys(tokens);

      console.log(`🔔 Notifying ${allTokens.length} users subscribed to ${category} > ${item}`);

      const payload = {
        title: `🔔 ${item} restocked!`,
        body: `Check the ${category} category now!`,
        data: { stock: `${category}/${item}` }
      };

      for (const token of allTokens) {
        await sendNotification(admin, token, payload);
      }
    } catch (err) {
      console.error('❌ Error parsing or notifying:', err);
    }
  });


  ws.on('close', () => {
    console.warn(`⚠️ WebSocket closed. Reconnecting in ${reconnectInterval / 1000}s...`);
    setTimeout(connectWebSocket, reconnectInterval);
  });

  ws.on('error', (err) => {
    console.error('❌ WebSocket error:', err);
  });
}

connectWebSocket();

module.exports = router;
