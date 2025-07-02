import admin from "firebase-admin";

// Initialize only once
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

export async function sendNotification(
  token: string,
  title: string,
  body: string,
  data?: Record<string, string>
) {
  const message = {
    token,
    notification: { title, body },
    data: data || {}
  };

  const response = await admin.messaging().send(message);
  return { messageId: response };
}
