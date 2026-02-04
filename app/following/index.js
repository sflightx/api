import express from "express";
import admin from "firebase-admin";
import { getDatabase } from "firebase-admin/database";
import fs from "fs";

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

// ADD OR REMOVE FOLLOWING

router.get("/:userId", async (req, res) => {
    const { userId } = req.params;
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const idToken = authHeader.split("Bearer ")[1];
        // Verify token to ensure requester is authenticated
        await sflightxApp.auth().verifyIdToken(idToken);

        const followingSnap = await db.ref(`user/following/${userId}`).get();
        const following = followingSnap.exists() ? Object.keys(followingSnap.val()) : [];

        res.json({ following });
    } catch (error) {
        console.error("Following GET Error:", error);
        res.status(403).json({ error: "Invalid Token" });
    }
});

router.get("/:userId", async (req, res) => {
    const { userId } = req.params;
    const authHeader = req.headers.authorization;

    // Check if token exists (verification logic omitted for brevity, but recommended)
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const followingSnap = await db.ref(`user/following/${userId}`).get();

        if (followingSnap.exists()) {
            // If following is stored as keys: { "uid1": true, "uid2": true }
            const following = Object.keys(followingSnap.val());
            res.json({ following });
        } else {
            res.json({ following: [] });
        }
    } catch (error) {
        console.error("Following API Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

export default router;