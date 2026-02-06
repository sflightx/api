import express from "express";
import admin from "firebase-admin";
import { getDatabase } from "firebase-admin/database";
import { migrateUserUpload, completeProfileDetails } from "./../../task/profileUpdateTask.js";
import fs from "fs";

// Load JSON manually instead of dynamic `import()`
const sflightxServiceAccount = JSON.parse(
  fs.readFileSync("/etc/secrets/serviceAccount_sflightx.json", "utf-8")
);

let sflightxApp;

// Initialize named Firebase app if not exists
if (!admin.apps.some((a) => a.name === "sflightxApp")) {
  sflightxApp = admin.initializeApp(
    {
      credential: admin.credential.cert(sflightxServiceAccount),
      databaseURL: "https://sflight-x-default-rtdb.firebaseio.com/",
    },
    "sflightxApp"
  );
} else {
  sflightxApp = admin.app("sflightxApp");
}

const db = getDatabase(sflightxApp);
const router = express.Router();

async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, error: "Missing or invalid Authorization header" });
  }

  const token = authHeader.split("Bearer ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
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

    const response = { uid, ...userData };

    if (includeCompany && userData.companyId) {
      const companySnap = await db
        .ref(`static/company/${userData.companyId}`)
        .get();

      if (companySnap.exists()) {
        response.company = companySnap.val();
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

  // ✅ Ensure token UID matches the target UID
  if (req.user.uid !== uid) {
    return res.status(403).json({
      success: false,
      error: "Unauthorized: You can only update your own profile",
    });
  }

  try {
    const db = getDatabase();

    // ✅ Get latest profile version
    const versionSnap = await get(ref(db, "app/profile/version"));
    const latestVersion = versionSnap.val() || "unknown";

    // ✅ Gather user data (from request or decoded token)
    const userData = {
      username: req.user.displayName || req.body.username,
      profile: req.user.profile || req.body.profile,
    };

    // ✅ Ensure profile exists and is updated
    await completeProfileDetails(uid, userData, latestVersion);

    // ✅ Optionally migrate user uploads
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
