import express from "express";
import admin from "firebase-admin";
import fs from "fs";

const sflightxServiceAccount = JSON.parse(
  fs.readFileSync("/etc/secrets/serviceAccount_sflightx.json", "utf-8")
);

let sflightxApp;
if (!admin.apps.some(a => a.name === "sflightxApp")) {
  sflightxApp = admin.initializeApp(
    {
      credential: admin.credential.cert(sflightxServiceAccount),
      databaseURL: "https://sflight-x-default-rtdb.firebaseio.com/"
    },
    "sflightxApp"
  );
} else {
  sflightxApp = admin.app("sflightxApp");
}

const router = express.Router();

// 🧩 Debug logger
function logDebug(...args) {
  console.log("[DEBUG]", ...args);
}

// 🧩 Helper: choose title/body dynamically
function getNotificationContent(type, extraMessage) {
  switch (type) {
    case "COMMENT":
      return {
        title: "New Comment",
        body: extraMessage || "Someone commented on your post."
      };
    case "LIKE":
      return {
        title: "New Like",
        body: "Someone liked your blueprint."
      };
    case "DISLIKE":
      return {
        title: "Reaction Update",
        body: "Someone disliked your blueprint."
      };
    case "FOLLOW":
      return {
        title: "New Follower",
        body: "Someone started following you!"
      };
    default:
      return {
        title: "SFlightX Notification",
        body: extraMessage || "You have a new notification."
      };
  }
}

// 🧩 Helper: create & store notification
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

  const refBase = sflightxApp.database().ref(`notification/user/${receiverId}`);
  const notificationId = isReaction
    ? `${postId || "none"}_REACTION_${senderId}`
    : refBase.push().key;

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

  const ref = sflightxApp
    .database()
    .ref(`notification/user/${receiverId}/${notificationId}`);

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

// 📨 Send to single user
router.post("/send", async (req, res) => {
  try {
    const {
      receiverId,
      senderId,
      type,
      key,
      postId,
      commentId,
      extraMessage,
      title,
      body,
      imageUrl,
      groupTag,
      sendAt
    } = req.body;

    logDebug("Incoming /send request:", req.body);

    // 1️⃣ Store notification in DB
    const notification = await createNotification({
      receiverId,
      senderId,
      type,
      postId,
      commentId,
      extraMessage
    });
    logDebug("Notification stored in DB:", notification);

    if (!notification) {
      logDebug("Notification already exists or invalid for receiver:", receiverId);
      return res.json({
        success: true,
        message: "Notification already exists or invalid"
      });
    }

    // 2️⃣ Fetch device token
    const tokenSnap = await sflightxApp
      .database()
      .ref(`userdata/${receiverId}/fcm_token`)
      .get();
    const token = tokenSnap.val();
    logDebug("Device token fetched:", token);

    if (!token) {
      logDebug("No device token found for receiver:", receiverId);
      return res.status(404).json({ error: "User has no device token" });
    }

    // 3️⃣ Dynamic notification content
    const { title: notifTitle, body: notifBody } = getNotificationContent(type, extraMessage);

    // 4️⃣ Build FCM message (with both `notification` + `data`)
    const message = {
      token,
      notification: {
        title: title || notifTitle,
        body: body || notifBody,
        image: imageUrl || undefined
      },
      data: {
        type: type || "generic",
        key: key || "",
        postId: postId || "",
        commentId: commentId || "",
        senderId: senderId || "",
        title: title || notifTitle,
        body: body || notifBody,
        imageUrl: imageUrl || "",
      },
      android: {
        priority: "high",
        notification: {
          icon: "ic_notification",
          color: "#4285F4",
          channelId: "default",
          tag: groupTag || undefined
        }
      }
    };

    logDebug("FCM message prepared:", message);

    // 5️⃣ Send immediately or schedule
    if (sendAt) {
      const delay = new Date(sendAt).getTime() - Date.now();
      if (delay > 0) {
        logDebug(`Scheduling notification in ${delay}ms`);
        setTimeout(
          () =>
            sflightxApp
              .messaging()
              .send(message)
              .then(r => logDebug("Scheduled FCM sent:", r))
              .catch(e => logDebug("Scheduled FCM error:", e)),
          delay
        );
        return res.json({ success: true, scheduled: true });
      }
    }

    const response = await sflightxApp.messaging().send(message);
    logDebug("FCM sent successfully:", response);

    res.json({ success: true, response });
  } catch (err) {
    console.error("[ERROR] Failed to send notification:", err);
    res
      .status(500)
      .json({ error: "Failed to send notification", details: err.message });
  }
});

export default router;
