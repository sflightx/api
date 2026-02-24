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

router.get("/:key", async (req, res) => {
    try {
        const { key } = req.params;
        const { limit = 25 } = req.query;

        const commentSnap = await db.ref(`comment/upload/blueprint/${key}`)
            .orderByChild('timestamp')
            .limitToLast(parseInt(limit))
            .get();

        if (!commentSnap.exists()) {
            return res.json([]);
        }

        const data = commentSnap.val();

        const commentsArray = Object.keys(data).map(id => ({
            ...data[id],
            key: id
        }));

        commentsArray.sort((a, b) => b.timestamp - a.timestamp);

        res.json(commentsArray);

    } catch (error) {
        console.error("Error fetching comments:", error);
        // Return 500 but keep the body empty or a simple error list
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;