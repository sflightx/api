const express = require("express");
const app = express();

app.use(express.json());

// Routers
const growAGardenRouter = require("./grow_a_garden/index");
app.use("/grow_a_garden", growAGardenRouter);

const discordRouter = require("./discord/index");
app.use("/discord", discordRouter);

const appRouter = require("./app/index");
app.use("/app", appRouter);

// Health check
app.get("/", (req, res) => {
  res.send("✅ API root: api.sflightx.com");
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🌐 API server running at http://localhost:${PORT}`));
