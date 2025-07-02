import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { sendNotification } from "./notify/send";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.post("/notify/send", async (req, res) => {
  const { token, title, body, data } = req.body;

  if (!token || !title || !body) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  try {
    const result = await sendNotification(token, title, body, data);
    res.json({ success: true, result });
  } catch (error: any) {
    console.error("FCM error:", error);
    res.status(500).json({ error: "Notification failed", message: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ API running on port ${PORT}`);
});
