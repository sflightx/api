export async function sendNotification(admin, token, payload) {
  try {
    await admin.messaging().send({
      token,
      notification: {
        title: payload.title,
        body: payload.body
      },
      data: payload.data || {}
    });
    console.log(`✅ Notification sent to ${token}`);
  } catch (error) {
    console.error(`❌ Error sending notification to ${token}:`, error.code);
    if (error.code === 'messaging/registration-token-not-registered') {
      await removeInvalidToken(admin.database(), token);
    }
  }
}

async function removeInvalidToken(db, token) {
  await db.ref(`token/${token}`).remove();
  console.log(`🗑 Removed invalid token: ${token}`);
}
