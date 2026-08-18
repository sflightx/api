import express from "express";

require('dotenv').config();
const { Client, GatewayIntentBits, WebhookClient } = require('discord.js');
const { Rcon } = require('rcon-client');
const axios = require('axios');
const Tail = require('tail').Tail;

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