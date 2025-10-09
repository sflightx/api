import express from "express";
import admin from "firebase-admin";
import { getDatabase } from "firebase-admin/database";
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

export default router;
