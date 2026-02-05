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
        const followerSnap = await db.ref(`user/followers/${userId}`).get();

        const following = followingSnap.exists() ? Object.keys(followingSnap.val()) : [];
        const followers = followerSnap.exists() ? Object.keys(followerSnap.val()) : [];

        res.json({
            following,
            followers,
            followingCount: following.length,
            followersCount: followers.length,
        });
    } catch (error) {
        console.error("Following GET Error:", error);
        res.status(403).json({ error: "Invalid Token" });
    }
});

// POST /:userId -> This is the "SET" part of your backend

router.post("/:userId", async (req, res) => {
    const { userId } = req.params;
    const { targetUserId } = req.body;

    if (!targetUserId) {
        return res.status(400).json({ error: "Missing targetUserId" });
    }

    try {
        const followingPath = `user/following/${userId}/${targetUserId}`;
        const followersPath = `user/followers/${targetUserId}/${userId}`;

        const snapshot = await db.ref(followingPath).get();

        const updates = {};
        if (snapshot.exists()) {
            updates[followingPath] = null;
            updates[followersPath] = null;

            await db.ref().update(updates);
            return res.json({ status: false, message: "Unfollowed" });
        } else {
            updates[followingPath] = true;
            updates[followersPath] = true;

            await db.ref().update(updates);
            return res.json({ status: true, message: "Followed" });
        }
    } catch (error) {
        console.error("Atomic Update Error:", error);
        return res.status(500).json({ error: "Failed to update following status" });
    }
});

export default router;