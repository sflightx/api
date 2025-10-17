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

// 🧩 Helper: create dynamic notification content
function getNotificationContent(type, extraMessage, senderName) {
  const displayName = senderName || "Someone";

  switch (type) {
    case "COMMENT":
      return {
        title: "New Comment",
        body: `${displayName} commented: "${extraMessage || "Check it out!"}"`
      };
    case "LIKE":
      return {
        title: "New Like",
        body: `${displayName} liked your blueprint.`
      };
    case "DISLIKE":
      return {
        title: "Reaction Update",
        body: `${displayName} disliked your blueprint.`
      };
    case "FOLLOW":
      return {
        title: "New Follower",
        body: `${displayName} started following you!`
      };
    case "POST":
      return {
        title: "New Post",
        body: `${displayName} posted ${extraMessage || "a new update."}`
      };
    default:
      return {
        title: "SFlightX Notification",
        body: extraMessage || `${displayName} sent you a notification.`
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
      return res.json({
        success: true,
        message: "Notification already exists or invalid"
      });
    }

    // 2️⃣ Fetch device token of receiver
    const tokenSnap = await sflightxApp
      .database()
      .ref(`userdata/${receiverId}/fcm_token`)
      .get();
    const token = tokenSnap.val();

    if (!token) {
      return res.status(404).json({ error: "User has no device token" });
    }

    // 3️⃣ Fetch sender info for personalization
    const senderSnap = await sflightxApp
      .database()
      .ref(`userdata/${senderId}`)
      .get();
    const senderData = senderSnap.val() || {};
    const senderName = senderData.username || "Someone";
    const senderImage =
      senderData.profileImage ||
      "https://api.sflightx.com/assets/default_avatar.png";

    // 4️⃣ Build personalized notification
    const content = getNotificationContent(type, extraMessage, senderName);

    // 5️⃣ Build FCM message
    const message = {
      token,
      notification: {
        title: content.title,
        body: content.body,
        image: senderImage // ✅ displays in Android notification tray
      },
      data: {
        type: type || "generic",
        key: key || "",
        postId: postId || "",
        commentId: commentId || "",
        senderId: senderId || "",
        senderName: senderName,
        imageUrl: senderImage
      },
      android: groupTag ? { notification: { tag: groupTag } } : undefined
    };

    logDebug("FCM message prepared:", message);

    // 6️⃣ Send or schedule
    if (sendAt) {
      const delay = new Date(sendAt).getTime() - Date.now();
      if (delay > 0) {
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

router.post("/broadcast", async (req, res) => {
  try {
    const { userIds, senderId, type, key, postId, commentId, extraMessage, title, body } = req.body;
    logDebug("Incoming /broadcast request:", req.body);

    if (!Array.isArray(userIds)) {
      logDebug("Invalid userIds array");
      return res.status(400).json({ error: "userIds must be an array" });
    }

    const tokens = [];
    const notifications = [];

    for (const receiverId of userIds) {
      const notification = await createNotification({
        receiverId,
        senderId,
        type,
        postId,
        commentId,
        extraMessage
      });
      logDebug("Notification stored for", receiverId, ":", notification);

      if (notification) notifications.push(notification);

      const snap = await sflightxApp.database().ref(`userdata/${receiverId}/fcm_token`).get();
      const token = snap.val();
      logDebug("Device token fetched for", receiverId, ":", token);

      if (token) tokens.push(token);
    }

    if (tokens.length === 0) {
      logDebug("No valid device tokens found");
      return res.status(404).json({ error: "No valid tokens found" });
    }

    const message = {
      tokens,
      data: {
        type: type || "generic",
        key: key || "",
        title: title || extraMessage || "SFlightX Notification",
        body: body || extraMessage || ""
      }
    };
    logDebug("FCM multicast message prepared:", message);

    const response = await sflightxApp.messaging().sendMulticast(message);
    logDebug("FCM multicast sent successfully:", response);

    res.json({ success: true, response, notificationsStored: notifications.length });

  } catch (err) {
    console.error("[ERROR] Broadcast failed:", err);
    res.status(500).json({ error: "Broadcast failed", details: err.message });
  }
});

export default router;
