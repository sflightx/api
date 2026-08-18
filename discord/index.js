import express from "express";
import dotenv from "dotenv";
import { Client, GatewayIntentBits, WebhookClient } from "discord.js";
import { Rcon } from "rcon-client";
import axios from "axios";
import TailModule from "tail";

const { Tail } = TailModule;
dotenv.config();

const router = express.Router();

router.get("/", (req, res) => {
  res.json({ message: "SFlightX Discord API online!" });
});

const {
    DISCORD_TOKEN,
    CHANNEL_ID,
    RCON_HOST,
    RCON_PORT,
    RCON_PASSWORD,
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
    console.log(`[SFlightX Bot] Logged in as ${client.user.tag}`);
});

export default router;