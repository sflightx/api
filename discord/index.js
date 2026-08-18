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

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const command = message.content.trim().toLowerCase();

  if (command === "!ping") {
    const host = MC_SERVER_IP || "voidcraftsmp.mcsh.io";
    const port = MC_SERVER_PORT || 19132;

    try {
      const response = await axios.get(`https://api.mcstatus.io/v2/status/bedrock/${host}:${port}`);
      const duration = Date.now() - startTime;
      const data = response.data;

      if (data.online) {
        await initialMsg.edit(
          `🟢 **Minecraft Server Online!**\n` +
          `📡 **Address:** \`${host}:${port}\`\n` +
          `⚡ **Latency:** \`${duration}ms\`\n` +
          `👥 **Players:** \`${data.players.online}/${data.players.max}\`\n` +
          `🏷️ **Version:** \`${data.version?.name || "Bedrock"}\``
        );
      } else {
        await initialMsg.edit(`🔴 **Server Offline:** \`${host}:${port}\` is unreachable.`);
      }
    } catch (err) {
      await initialMsg.edit(`❌ **Failed to ping server:** Could not fetch status for \`${host}:${port}\`.`);
    }
  }
});

if (DISCORD_TOKEN) {
  client.login(DISCORD_TOKEN).catch((error) => {
    console.error("❌ Error logging in to Discord:", error);
  });
} else {
  console.error("❌ DISCORD_TOKEN is missing in environment variables!");
}

export default router;