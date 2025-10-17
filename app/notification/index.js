import express from "express";
import admin from "firebase-admin";
import fs from "fs";

const sflightxServiceAccount = JSON.parse(
  fs.readFileSync("/etc/secrets/serviceAccount_sflightx.json", "utf-8")
);

let sflightxApp;
if (!admin.apps.some(a => a.name === "sflightxApp")) {
  sflightxApp = admin.initializeApp({
    credential: admin.credential.cert(sflightxServiceAccount),
    databaseURL: "https://sflight-x-default-rtdb.firebaseio.com/"
  }, "sflightxApp");
} else {
  sflightxApp = admin.app("sflightxApp");
}

const router = express.Router();

// Send to single user
router.post("/send", async (req, res) => {
  try {
    const { userId, type, key, title, body, imageUrl, groupTag, sendAt } = req.body;

    const tokenSnap = await admin.database().ref(`userdata/${userId}/deviceToken`).get();
    const token = tokenSnap.val();
    if (!token) return res.status(404).json({ error: "User has no device token" });

    const message = {
      token,
      data: {
        type: type || "generic",
        key: key || "",
        title: title || "SFlightX Notification",
        body: body || "",
        imageUrl: imageUrl || "https://api.sflightx.com/assets/default_notification.png"
      },
      android: groupTag ? { notification: { tag: groupTag } } : undefined
    };

    if (sendAt) {
      const delay = new Date(sendAt).getTime() - Date.now();
      if (delay > 0) {
        setTimeout(() => sflightxApp.messaging().send(message), delay);
        return res.json({ success: true, scheduled: true });
      }
    }

    const response = await sflightxApp.messaging().send(message);
    res.json({ success: true, response });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send notification" });
  }
});


// Broadcast to multiple users
router.post("/broadcast", async (req, res) => {
  try {
    const { userIds, type, key, title, body } = req.body;
    if (!Array.isArray(userIds)) return res.status(400).json({ error: "userIds must be an array" });

    const tokens = [];
    for (const id of userIds) {
      const snap = await admin.database().ref(`userdata/${id}/deviceToken`).get();
      const token = snap.val();
      if (token) tokens.push(token);
    }

    if (tokens.length === 0) return res.status(404).json({ error: "No valid tokens found" });

    const message = {
      tokens,
      data: {
        type: type || "generic",
        key: key || "",
        title: title || "SFlightX Notification",
        body: body || ""
      }
    };

    const response = await sflightxApp.messaging().sendMulticast(message);
    res.json({ success: true, response });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Broadcast failed" });
  }
});

export default router;