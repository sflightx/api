import express from "express";
import fcmRoutes from "./fcm/sendNotification";

// Import postManifest.js (and run it immediately)
import("./discord/postManifest.js")
  .then(() => console.log("Discord manifest posted."))
  .catch((err) => console.error("Failed to post Discord manifest:", err));

const app = express();

app.use(express.json());
app.use("/send-fcm", fcmRoutes);

export default app;
