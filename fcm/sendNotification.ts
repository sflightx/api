import * as admin from "firebase-admin";
import express, { Request, Response } from "express";
import dotenv from "dotenv";

// Load environment variables from .env
dotenv.config();

// Initialize Firebase if not already initialized
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FCM_SERVICE_ACCOUNT_KEY!)),
  });
}

const router = express.Router();

router.post("/", async (req: Request, res: Response) => {
  const { token, title, body, data } = req.body;

  const message = {
    token,
    notification: { title, body },
    data: data || {},
  };

  try {
    const response = await admin.messaging().send(message);
    res.json({ success: true, response });
  } catch (error) {
    console.error("FCM error:", error);
    res.status(500).json({ success: false, error });
  }
});

export default router;
