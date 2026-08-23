import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import axios from "axios";
import dotenv from "dotenv";
import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";

dotenv.config();

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  MC_SERVER_IP,
  MC_SERVER_PORT,
  CHANNEL_ID,
  PORT = 3000,
} = process.env;

// Initialize Express and HTTP Server
const app = express();
app.use(express.json());

const server = http.createServer(app);

// Initialize WebSocket Server on /v1/stream
const wss = new WebSocketServer({ server, path: "/v1/stream" });
const clients = new Set();

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log("🟢 Client connected to api.sflightx.com stream");

  ws.on("message", async (message) => {
    try {
      const payload = JSON.parse(message.toString());
      console.log("Received WS payload:", payload);

      // Route WebSocket events directly to Discord
      await handleIncomingWsEvent(payload);
    } catch (err) {
      console.log("Received raw WS text:", message.toString());
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log("🔴 Client disconnected from stream");
  });
});

// Helper: Broadcast data out to connected WebSocket clients
function broadcastToClients(data) {
  const payload = JSON.stringify(data);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// REST Endpoint to trigger updates via HTTP POST
app.post("/v1/broadcast", (req, res) => {
  broadcastToClients(req.body);
  res.json({ success: true, clients: clients.size });
});

// 1. Define Slash Commands
const commands = [
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Check status of the server and player count."),
].map((command) => command.toJSON());

// Register Slash Commands Function
async function registerSlashCommands() {
  if (!DISCORD_TOKEN || !CLIENT_ID) return;
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  try {
    console.log("⌛ Registering slash commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Slash commands registered successfully!");
  } catch (error) {
    console.error("❌ Failed to register slash commands:", error);
  }
}

// 2. Initialize Discord Client
export const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  presence: {
    status: "online",
    activities: [
      {
        name: "Checking status of VoidCraft SMP",
        type: 0, // Playing
      },
    ],
  },
});

let isServerOnline = false;

// Function to handle incoming events from WS (Deaths, Chat, Inflation)
async function handleIncomingWsEvent(payload) {
  if (!CHANNEL_ID) return;
  const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
  if (!channel) return;

  // Event 1: Inflation / Economy Updates
  if (payload.type === "INFLATION_UPDATE") {
    const inflationEmbed = new EmbedBuilder()
      .setColor(0xf1c40f) // Gold
      .setTitle("📊 Market Inflation Update")
      .setDescription(`Current Rate: **${payload.rate}%**`)
      .addFields({ name: "Shift", value: `${payload.change || "0"}%`, inline: true })
      .setFooter({ text: "api.sflightx.com Economy Feed" })
      .setTimestamp();

    await channel.send({ embeds: [inflationEmbed] });
  }

  // Event 2: Minecraft Player Death Event
  if (payload.type === "PLAYER_DEATH") {
    await channel.send(`☠️ **Death Alert:** ${payload.message || "A player has died!"}`);
  }

  // Event 3: In-game Chat Message Bridging
  if (payload.type === "IN_GAME_CHAT") {
    await channel.send(`💬 **[In-Game] ${payload.username}:** ${payload.message}`);
  }
}

// 3. Register Slash Commands & Watcher on Ready
client.once(Events.ClientReady, async (c) => {
  console.log(`🤖 Discord Bot Ready! Logged in as ${c.user.tag}`);
  await registerSlashCommands();

  const CHECK_INTERVAL = 30 * 1000; // 30 seconds

  setInterval(async () => {
    const host = MC_SERVER_IP || "15.235.144.117";
    const port = MC_SERVER_PORT || 14902;

    try {
      const response = await axios.get(
        `https://api.mcstatus.io/v2/status/bedrock/${host}:${port}`
      );
      const data = response.data;

      // STATE TRANSITION: Server ONLINE
      if (data.online && !isServerOnline) {
        isServerOnline = true;
        console.log("🟢 Server boot detected! Sending Discord announcement...");

        const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
        if (channel) {
          const onlineEmbed = new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle("Server is now ONLINE!")
            .setDescription("The server is available for players to join.")
            .addFields(
              { name: "🏷️ Version", value: `\`${data.version?.name || "Bedrock Edition"}\``, inline: true },
              { name: "👥 Players", value: `\`${data.players.online} / ${data.players.max}\``, inline: true }
            )
            .setFooter({ text: "Automated Server Status Watcher" })
            .setTimestamp();

          await channel.send({ embeds: [onlineEmbed] });
        }
      } 
      // STATE TRANSITION: Server OFFLINE
      else if (!data.online && isServerOnline) {
        isServerOnline = false;
        console.log("🔴 Server shutdown detected.");

        const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
        if (channel) {
          const offlineEmbed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("Server just went OFFLINE")
            .setDescription("Contact an admin. It may be undergoing maintenance or experiencing issues.")
            .setFooter({ text: "Automated Server Status Watcher" })
            .setTimestamp();

          await channel.send({ embeds: [offlineEmbed] });
        }
      }
    } catch (err) {
      console.error("Status watcher poll error:", err.message);
    }
  }, CHECK_INTERVAL);
});

// 4. Slash Command Interactions
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "status") {
    await interaction.deferReply();

    const host = MC_SERVER_IP || "15.235.144.117";
    const port = MC_SERVER_PORT || 14902;
    const startTime = Date.now();

    try {
      const response = await axios.get(
        `https://api.mcstatus.io/v2/status/bedrock/${host}:${port}`
      );
      const duration = Date.now() - startTime;
      const data = response.data;

      if (data.online) {
        const onlineEmbed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle("🟢 Server is ONLINE")
          .setDescription("The server is active and reachable.")
          .addFields(
            { name: "⚡ Latency", value: `\`${duration}ms\``, inline: true },
            { name: "👥 Players", value: `\`${data.players.online} / ${data.players.max}\``, inline: true },
            { name: "🏷️ Version", value: `\`${data.version?.name || "Bedrock Edition"}\``, inline: false }
          )
          .setFooter({ text: "VoidCraft SMP • Live Status" })
          .setTimestamp();

        await interaction.editReply({ embeds: [onlineEmbed] });
      } else {
        const offlineEmbed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("🔴 Server is OFFLINE")
          .setDescription("Unable to establish a connection to the server.")
          .setFooter({ text: "VoidCraft SMP • Live Status" })
          .setTimestamp();

        await interaction.editReply({ embeds: [offlineEmbed] });
      }
    } catch (err) {
      await interaction.editReply("**Failed to ping server:** Could not fetch server status.");
    }
  }
});

// Unhandled Errors
process.on("unhandledRejection", (reason) => console.error("Unhandled Rejection:", reason));
process.on("uncaughtException", (err) => console.error("Uncaught Exception:", err));

// 5. Start HTTP/WebSocket Server and Login Bot
server.listen(PORT, () => {
  console.log(`🚀 API & WebSocket Server running on port ${PORT}`);
});

const loginWithRetry = async (retries = 5, delay = 5000) => {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`🔑 Logging into Discord (Attempt ${i + 1}/${retries})...`);
      await client.login(DISCORD_TOKEN);
      console.log("Connected successfully!");
      return;
    } catch (error) {
      console.error(`Login attempt ${i + 1} failed:`, error.message);
      if (error.status === 429 || error.message.includes("429")) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      } else {
        break;
      }
    }
  }
};

if (DISCORD_TOKEN) {
  loginWithRetry();
} else {
  console.error("❌ DISCORD_TOKEN is missing in environment variables!");
}