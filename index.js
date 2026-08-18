import express from "express";
import cors from "cors";

// Import Discord module (executes bot login and command handlers)
import "./discord/index.js"; 

import appRouter from "./app/index.js";
import appUserRouter from "./app/user/index.js";
import appBlueprintRouter from "./app/blueprint/index.js";
import appCommentRouter from "./app/comment/index.js";
import appFollowingRouter from "./app/following/index.js";
import appNotificationRouter from "./app/notification/index.js";

const app = express();

app.set('trust proxy', 1);
app.use(express.json());

app.use(cors({
  origin: ["http://127.0.0.1:5500", "https://sflightx.com"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

// Routers
app.use("/app", appRouter);
app.use("/app/user", appUserRouter);
app.use("/app/blueprint", appBlueprintRouter);
app.use("/app/comment", appCommentRouter);
app.use("/app/following", appFollowingRouter);
app.use("/app/notification", appNotificationRouter);

app.get("/api/discord", (req, res) => {
  res.json({ message: "SFlightX Discord API online!" });
});

// Health check endpoint for UptimeRobot / Render
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.get("/", (req, res) => {
  res.send("✅ API root: api.sflightx.com is working.");
});

// Single app listener for Render
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 API and Discord Bot running at http://0.0.0.0:${PORT}`);
});