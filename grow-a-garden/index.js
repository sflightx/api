const express = require('express');
const router = express.Router();
const WebSocket = require('ws');
const admin = require('firebase-admin');
const { sendNotification } = require('../functions/sendNotification');
const { saveToken } = require('../functions/registerToken');

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
      const tokensSnapshot = await db.ref('token').once('value');
      const tokensData = tokensSnapshot.val() || {};
      const allTokens = Object.keys(tokensData);

      console.log(`🔔 Sending notifications to ${allTokens.length} devices...`);
      const payload = {
        title: '🌱 Grow A Garden Stock Reset!',
        body: 'New stock is live!',
        data: { stock: data.toString() }
      };

      for (const token of allTokens) {
        await sendNotification(admin, token, payload);
      }
    } catch (err) {
      console.error('❌ Error notifying users:', err);
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
