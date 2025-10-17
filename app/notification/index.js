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

// Helper: create & store notification in database
async function createNotification({
  receiverId,
  senderId,
  type,
  postId = null,
  commentId = null,
  extraMessage = "",
  timestamp = Date.now()
}) {
  if (!receiverId || !type || receiverId === senderId) return null;

  const isReaction = type === "LIKE" || type === "DISLIKE";

  const notificationId = isReaction
    ? `${postId || "none"}_REACTION_${senderId}`
    : admin.database().ref(`notification/user/${receiverId}`).push().key;

  const notification = {
    id: notificationId,
    type,
    senderId,
    postId,
    commentId,
    message: extraMessage,
    timestamp,
    isRead: false
  };

  const ref = admin.database().ref(`notification/user/${receiverId}/${notificationId}`);

  if (isReaction) {
    const snapshot = await ref.get();
    const alreadyExists = snapshot.exists();
    await ref.set(notification);

    return alreadyExists ? null : notification;
  } else {
    await ref.set(notification);
    return notification;
  }
}

// Send to single user
router.post("/send", async (req, res) => {
  try {
    const { receiverId, senderId, type, key, postId, commentId, extraMessage, title, body, imageUrl, groupTag, sendAt } = req.body;

    // 1️⃣ Store notification in DB
    const notification = await createNotification({
      receiverId,
      senderId,
      type,
      postId,
      commentId,
      extraMessage
    });

    if (!notification) return res.json({ success: true, message: "Notification already exists or invalid" });

    // 2️⃣ Send FCM
    const tokenSnap = await admin.database().ref(`userdata/${receiverId}/deviceToken`).get();
    const token = tokenSnap.val();
    if (!token) return res.status(404).json({ error: "User has no device token" });

    const message = {
      token,
      data: {
        type: type || "generic",
        key: key || "",
        title: title || extraMessage || "SFlightX Notification",
        body: body || extraMessage || "",
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
    const { userIds, senderId, type, key, postId, commentId, extraMessage, title, body } = req.body;
    if (!Array.isArray(userIds)) return res.status(400).json({ error: "userIds must be an array" });

    const tokens = [];
    const notifications = [];

    for (const receiverId of userIds) {
      // 1️⃣ Store notification
      const notification = await createNotification({
        receiverId,
        senderId,
        type,
        postId,
        commentId,
        extraMessage
      });

      if (notification) notifications.push(notification);

      // 2️⃣ Collect device tokens
      const snap = await admin.database().ref(`userdata/${receiverId}/deviceToken`).get();
      const token = snap.val();
      if (token) tokens.push(token);
    }

    if (tokens.length === 0) return res.status(404).json({ error: "No valid tokens found" });

    // 3️⃣ Send FCM multicast
    const message = {
      tokens,
      data: {
        type: type || "generic",
        key: key || "",
        title: title || extraMessage || "SFlightX Notification",
        body: body || extraMessage || ""
      }
    };

    const response = await sflightxApp.messaging().sendMulticast(message);
    res.json({ success: true, response, notificationsStored: notifications.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Broadcast failed" });
  }
});

export default router;
