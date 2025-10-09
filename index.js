import express from "express";
import growAGardenRouter from "./grow_a_garden/index.js";
import discordRouter from "./discord/index.js";
import appRouter from "./app/index.js";
import appUserRouter from "./app/user/index.js";


const app = express();
app.use(express.json());

// Routers
app.use("/grow_a_garden", growAGardenRouter);
app.use("/discord", discordRouter);

app.use("/app", appRouter);
app.use("/app/user", appUserRouter);

// Health check
app.get("/", (req, res) => {
  res.send("✅ API root: api.sflightx.com");
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🌐 API server running at http://localhost:${PORT}`));
