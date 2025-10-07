async function saveToken(db, fcmToken) {
  await db.ref(`token/${fcmToken}`).set(true);
  console.log(`✅ Token saved: ${fcmToken}`);
}

module.exports = { saveToken };
