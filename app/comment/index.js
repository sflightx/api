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

        const commentSnap = await db.ref(`comment/upload/blueprint/${key}`).get();

        if (!commentSnap.exists()) {
            return res.json([]);
        }

        const rawData = commentSnap.val();

        const commentsArray = Object.keys(rawData).map(commentId => {
            const comment = rawData[commentId];
            return {
                ...comment,
                key: commentId
            };
        });

        commentsArray.sort((a, b) => b.timestamp - a.timestamp);

        res.json(commentsArray);
    } catch (error) {
        console.error("Backend fetch error:", error);
        res.status(500).json([]);
    }
});

router.delete("/:key/:commentId", verifyToken, async (req, res) => {
    // 1. Token & Header Validation
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            error: "Unauthorized: Missing or malformed Bearer token"
        });
    }

    try {
        const { key, commentId } = req.params;

        const uid = req.user?.uid;
        if (!uid) {
            return res.status(401).json({ success: false, error: "Invalid user session" });
        }

        const commentRef = db.ref(`comment/upload/blueprint/${key}/${commentId}`);
        const snapshot = await commentRef.get();

        // 2. Existence Check
        if (!snapshot.exists()) {
            return res.status(404).json({
                success: false,
                error: "Comment not found"
            });
        }

        const commentData = snapshot.val();

        // 3. Ownership Validation
        // Check if the user is the author OR potentially an admin
        const isAuthor = commentData.author === uid;

        if (!isAuthor) {
            return res.status(403).json({
                success: false,
                error: "Forbidden: You do not have permission to delete this comment"
            });
        }

        // 4. Atomic Deletion
        await commentRef.remove();

        return res.status(200).json({
            success: true,
            message: "Comment successfully deleted"
        });

    } catch (error) {
        console.error(`[DeleteError] Path: ${req.originalUrl} | Error:`, error.message);

        return res.status(500).json({
            success: false,
            error: "Internal server error occurred during deletion"
        });
    }
});

export default router;