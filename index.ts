import express from "express";
import fcmRoutes from "./fcm/sendNotification";

const app = express();

app.use(express.json());
app.use("/send-fcm", fcmRoutes);

export default app;
