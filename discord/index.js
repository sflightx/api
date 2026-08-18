import express from "express";
import dotenv from "dotenv";
import { Client, GatewayIntentBits, Events } from "discord.js";
dotenv.config();

const router = express.Router();

router.get("/", (req, res) => {
  res.json({ message: "SFlightX Discord API online!" });
});

const {
    DISCORD_TOKEN,
    CHANNEL_ID,
    API_URL
} = process.env;

// Initialize Discord Client & Webhook
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once(Events.ClientReady, (readyClient) => {
	console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.login(DISCORD_TOKEN).catch((error) => {
    console.error("❌ Error logging in to Discord:", error);
});

export default router;