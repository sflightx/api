import express from "express";
import admin from "firebase-admin";
import { getDatabase } from "firebase-admin/database";
import { migrateUserUpload, completeProfileDetails } from "./../../task/profileUpdateTask.js";
import fs from "fs";

// Load JSON manually instead of dynamic `import()`
const sflightxServiceAccount = JSON.parse(
  fs.readFileSync("/etc/secrets/serviceAccount_sflightx.json", "utf-8")
);

const sflightxApp = admin.apps.find(a => a.name === "sflightxApp")
  || admin.initializeApp({
    credential: admin.credential.cert(sflightxServiceAccount),
    databaseURL: "https://sflight-x-default-rtdb.firebaseio.com/",
  }, "sflightxApp");

const db = getDatabase(sflightxApp);
const router = express.Router();

async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, error: "Missing or invalid Authorization header" });
  }

  const token = authHeader.split("Bearer ")[1];

  try {
    const decoded = await admin.auth(sflightxApp).verifyIdToken(token);
    req.user = decoded; // contains uid, email, etc.
    next();
  } catch (error) {
    console.error("Token verification failed:", error);
    return res.status(401).json({ success: false, error: "Invalid token" });
  }
}

/**
 * GET /app/user/:uid/
 * Returns the user's data
 */

router.get("/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    const includeCompany = req.query.includeCompany === "true";

    const userSnap = await db.ref(`userdata/${uid}`).get();
    if (!userSnap.exists()) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = userSnap.val();

    const response = {
      uid: uid,
      username: userData.username,
      bio: userData.bio,
      profile: userData.profile,
      profile_verified: userData.profile_verified,
      profile_version: userData.profile_version,
      link: userData.link || {}, // Includes X and YouTube from your screenshot
      timestamp_join: userData.timestamp_join
    };

    if (includeCompany && userData.companyId) {
      const companySnap = await db
        .ref(`static/company/${userData.companyId}`)
        .get();

      if (companySnap.exists()) {
        const companyData = companySnap.val();
        response.company = {
          name: companyData.name,
          desc: companyData.desc,
          thumbnail: companyData.thumbnail,
          link: companyData.link || {},
        };
      } else {
        response.company = null;
      }
    }

    res.json(response);
  } catch (err) {
    console.error("Error fetching user:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * returns the user's profile picture URL
 */
router.get("/:uid/profile", async (req, res) => {
  try {
    const { uid } = req.params;
    const profilePicRef = db.ref(`userdata/${uid}/profile`);
    const snapshot = await profilePicRef.get();
    if (!snapshot.exists()) {
      return res.status(404).json({ error: "Profile picture not found" });
    }
    const pictureUrl = snapshot.val();
    res.json({ pictureUrl });
  } catch (err) {
    console.error("Error fetching profile picture:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * returns the user's username
 */
router.get("/:uid/username", async (req, res) => {
  try {
    const { uid } = req.params;
    const usernameRef = db.ref(`userdata/${uid}/username`);
    const snapshot = await usernameRef.get();
    if (!snapshot.exists()) {
      return res.status(404).json({ error: "Username not found" });
    }
    const username = snapshot.val();
    res.json({ username });
  } catch (err) {
    console.error("Error fetching username:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


/**
 * GET /app/user/:uid/verified
 * Returns the user's verification status (true/false)
 */
router.get("/:uid/verified", async (req, res) => {
  const { uid } = req.params;

  if (!uid) {
    return res.status(400).json({ error: "Missing user ID" });
  }

  try {
    const ref = db.ref(`userdata/${uid}/settings/verification/verified`);
    const snapshot = await ref.get();

    // Default to false if not found
    const isVerified = snapshot.exists() ? snapshot.val() === true : false;

    return res.json({ verified: isVerified });
  } catch (error) {
    console.error("Error fetching verification status:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /app/user/:uid/updateProfile
 * Update user profile details
 */
router.post("/:uid/updateProfile", verifyToken, async (req, res) => {
  const { uid } = req.params;
  const { username, profile } = req.body;

  // ✅ Ensure token UID matches the target UID
  if (req.user.uid !== uid) {
    return res.status(403).json({
      success: false,
      error: "Unauthorized: You can only update your own profile",
    });
  }

  const cleanUsername = username?.replace(/<[^>]*>?/gm, '').trim();
  const cleanProfile = profile?.replace(/<[^>]*>?/gm, '').trim();

  if (cleanUsername && cleanUsername.length > 25) {
    return res.status(400).json({ error: "Username too long" });
  }

  try {
    const db = getDatabase();

    const versionSnap = await db.ref("app/profile/version").get();
    const latestVersion = versionSnap.val() || "unknown";

    const userData = {
      username: cleanUsername || req.user.displayName,
      profile: cleanProfile || req.user.profile,
    };

    await completeProfileDetails(uid, userData, latestVersion);
    await migrateUserUpload(uid);

    res.json({
      success: true,
      message: "Profile updated successfully",
      version: latestVersion,
    });
  } catch (error) {
    console.error("Profile update failed:", error);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
