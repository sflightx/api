import express from "express";
import dotenv from "dotenv";
import { Client, GatewayIntentBits, WebhookClient } from "discord.js";
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

const webhookClient = WEBHOOK_URL ? new WebhookClient({ url: WEBHOOK_URL }) : null;

client.once('ready', () => {
    console.log(`[VoidCraft Messenger] Logged in as ${client.user.tag}`);
});

export default router;