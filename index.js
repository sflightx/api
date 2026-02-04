import express from "express";
import cors from "cors";

import growAGardenRouter from "./grow_a_garden/index.js";
import discordRouter from "./discord/index.js";

import appRouter from "./app/index.js";
import appUserRouter from "./app/user/index.js";
import appBlueprintRouter from "./app/blueprint/index.js";
import appFollowingRouter from "./app/following/index.js";
import appNotificationRouter from "./app/notification/index.js";


const app = express();
app.use(express.json());

app.use(cors({
  origin: ["http://127.0.0.1:5500", "https://sflightx.com"], // allowed origins
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));


// Routers
app.use("/grow_a_garden", growAGardenRouter);
app.use("/discord", discordRouter);

app.use("/app", appRouter);
app.use("/app/user", appUserRouter);
app.use("/app/blueprint", appBlueprintRouter);
app.use("/app/following", appFollowingRouter);
app.use("/app/notification", appNotificationRouter);

// Health check
app.get("/", (req, res) => {
  res.send("✅ API root: api.sflightx.com");
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🌐 API server running at http://localhost:${PORT}`));
