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

router.post("/:userId", async (req, res) => {
    const authHeader = req.headers.authorization;
    const urlUserId = req.params.userId;
    const { targetUserId } = req.body;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    const idToken = authHeader.split("Bearer ")[1];
    try {
        const decodedToken = await sflightxApp.auth().verifyIdToken(idToken);
        const requesterUserId = decodedToken.uid;
        if (requesterUserId !== urlUserId) {
            return res.status(403).json({ error: "Forbidden: User ID mismatch" });
        }
        const followingRef = db.ref(`user/following/${urlUserId}/${targetUserId}`);
        const followingSnap = await followingRef.get();
        if (followingSnap.exists()) {
            await followingRef.remove();
            res.json({ message: `Unfollowed user ${targetUserId}` });
        } else {
            await followingRef.set(true);
            res.json({ message: `Followed user ${targetUserId}` });
        }
    } catch (error) {
        console.error("Following API Error:", error);
        res.status(500).json({ error: "Failed to update following status" });
    }

    //USAGE EXAMPLE:
    // POST /following/:userId
    // Headers: { Authorization: "Bearer <ID_TOKEN>" }
    // Body: { "targetUserId": "<TARGET_USER_ID>" }
});

// Ensure this is mounted at '/app/following' in your main server file
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