import express from "express";
import { Client, GatewayIntentBits, Events } from "discord.js";
import dotenv from "dotenv";
dotenv.config();

const { DISCORD_TOKEN } = process.env;
const router = express.Router();
const app = express();

app.get("/", (req, res) => {
  res.status(200).json({ status: "online", message: "SFlightX and VoidCraft Discord Bot & API active!" });
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Ready! Logged in as ${c.user.tag}`);
});

if (DISCORD_TOKEN) {
  client.login(DISCORD_TOKEN).catch((error) => {
    console.error("❌ Error logging in to Discord:", error);
  });
} else {
  console.error("❌ DISCORD_TOKEN is missing in environment variables!");
}

export default router;