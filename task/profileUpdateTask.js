import admin from "firebase-admin";

const db = admin.database();

export async function migrateUserUpload(uid) {
  if (!uid) throw new Error("Missing UID");

  const uploadRef = db.ref(`userdata/${uid}/upload`);
  const snapshot = await uploadRef.get();

  if (!snapshot.exists()) {
    console.log(`ℹ️ No upload data for user ${uid}`);
    return;
  }

  const value = snapshot.val();

  // Check if it's still in the old format (array)
  if (Array.isArray(value)) {
    const newMap = {};

    for (const item of value) {
      if (typeof item === "string") {
        newMap[item] = true;
      }
    }

    // ✅ Write new format
    await uploadRef.set(newMap);

    // ✅ Add migration flag
    await db
      .ref(`userdata/${uid}/settings/migration/upload`)
      .set(true);

    console.log(`✅ Migration completed for user: ${uid}`);
  } else {
    console.log(`ℹ️ Upload format already migrated for user: ${uid}`);
  }
}
