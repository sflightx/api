import admin from "firebase-admin";
import { getDatabase, ref, get, set, update } from "firebase/database";

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

/**
 * Ensures user profile data exists and updates it if needed.
 * - If user data does not exist, it creates it.
 * - Always updates the `profile`, `profile_version`, and other core fields.
 *
 * @param {string} uid - The user's Firebase UID.
 * @param {object} userData - The user data from Firebase Auth or your app.
 * @param {string} latestVersion - The latest app or profile version string.
 * @returns {Promise<void>}
 */
export async function completeProfileDetails(uid, userData, latestVersion) {
  const db = getDatabase();
  const userRef = ref(db, `userdata/${uid}`);

  const updates = {
    profile: userData.photoUrl || null,
    profile_version: latestVersion,
    username: userData.displayName || "Anonymous",
    uid: uid,
    timestamp_update: Date.now(),
  };

  try {
    const snapshot = await get(userRef);
    if (!snapshot.exists()) {
      // Create new profile
      await set(userRef, updates);
      console.log(`[API] Created new user profile for UID: ${uid}`);
    } else {
      // Update existing profile
      await update(userRef, updates);
      console.log(`[API] Updated user profile for UID: ${uid}`);
    }
  } catch (err) {
    console.error("[API] Failed to ensure user profile:", err);
    throw err;
  }
}