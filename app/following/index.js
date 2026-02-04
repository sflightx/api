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

// POST /:userId -> This is the "SET" part of your backend

router.post("/:userId", async (req, res) => {
    const { userId } = req.params; // The user doing the action
    const { targetUserId } = req.body; // The user being followed/unfollowed
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const idToken = authHeader.split("Bearer ")[1];
        const decodedToken = await sflightxApp.auth().verifyIdToken(idToken);

        // Security: Ensure the person logged in is the one trying to update their list
        if (decodedToken.uid !== userId) {
            return res.status(403).json({ error: "Forbidden: UID mismatch" });
        }

        const followingRef = db.ref(`user/following/${userId}/${targetUserId}`);
        const snapshot = await followingRef.get();

        if (snapshot.exists()) {
            // If already following, remove it (Unfollow)
            await followingRef.remove();
            res.json({ message: "Unfollowed", status: false });
        } else {
            // If not following, set it (Follow)
            await followingRef.set(true);
            res.json({ message: "Followed", status: true });
        }
    } catch (error) {
        console.error("Set Following Error:", error);
        res.status(500).json({ error: "Failed to update database" });
    }
});

export default router;