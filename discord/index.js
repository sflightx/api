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
  WEBSOCKET_URL, // Your MCServerHost / Pterodactyl WS URL
  PTERO_TOKEN,   // Optional: token if required separately by panel
  PORT = 3000,
} = process.env;

// Initialize Express and HTTP Server
const app = express();
app.use(express.json());

const server = http.createServer(app);

// Initialize WebSocket Server on /v1/stream for api.sflightx.com clients
const wss = new WebSocketServer({ server, path: "/v1/stream" });
const clients = new Set();

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log("🟢 External client connected to api.sflightx.com stream");

  ws.on("message", async (message) => {
    try {
      const payload = JSON.parse(message.toString());
      await handleIncomingWsEvent(payload);
    } catch (err) {
      console.log("Received raw WS text:", message.toString());
    }
  });

  ws.on("close", () => clients.delete(ws));
});

// Helper: Broadcast data out to external clients listening on api.sflightx.com
function broadcastToClients(data) {
  const payload = JSON.stringify(data);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

app.post("/v1/broadcast", (req, res) => {
  broadcastToClients(req.body);
  handleIncomingWsEvent(req.body);
  res.json({ success: true, clients: clients.size });
});

// ==========================================
// PTERODACTYL / MCSERVERHOST WEBSOCKET BRIDGE
// ==========================================
function connectToMCServerHost() {
  if (!WEBSOCKET_URL) {
    console.warn("⚠️ WEBSOCKET_URL is missing in Render environment variables!");
    return;
  }

  console.log("🔌 Connecting to MCServerHost Console WebSocket...");
  const mcSocket = new WebSocket(WEBSOCKET_URL);

  mcSocket.on("open", () => {
    console.log("🟢 Connected to MCServerHost WebSocket!");
    
    // Authenticate with Pterodactyl if token is provided
    if (PTERO_TOKEN) {
      mcSocket.send(JSON.stringify({ event: "auth", args: [PTERO_TOKEN] }));
    }
  });

  mcSocket.on("message", async (data) => {
    try {
      const parsed = JSON.parse(data.toString());

      // Pterodactyl console logs arrive under event "console output"
      if (parsed.event === "console output" && parsed.args && parsed.args[0]) {
        const logLine = parsed.args[0];
        await parseBedrockConsoleLine(logLine);
      }
    } catch (err) {
      // Raw string output fallback
      await parseBedrockConsoleLine(data.toString());
    }
  });

  mcSocket.on("error", (err) => {
    console.error("❌ MCServerHost WebSocket error:", err.message);
  });

  mcSocket.on("close", () => {
    console.warn("🔴 MCServerHost WebSocket disconnected. Retrying in 10s...");
    setTimeout(connectToMCServerHost, 10000); // Auto-reconnect
  });
}

async function parseBedrockConsoleLine(line) {
  if (!CHANNEL_ID) return;

  // 1. Clean ANSI color escape sequences and trim line
  const cleanLine = line.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").trim();

  // Ignore system noise or startup lines
  if (!cleanLine || cleanLine.includes("NO_TRANSLATE")) return;

  console.log(`[MC RAW LOG] ${cleanLine}`);

  const channel = await client.channels.fetch(CHANNEL_ID).catch((err) => {
    console.error(`❌ [Discord Fetch Error] Could not fetch channel:`, err.message);
    return null;
  });

  // 2. CAPTURE PLAYER CONNECTS: "[Timestamp INFO] Player connected: edrek0729, xuid: ..."
  if (cleanLine.includes("Player connected:")) {
    const username = cleanLine.split("Player connected:")[1].split(",")[0].trim();
    
    console.log(`✅ [API Event] Captured JOIN event for player: ${username}`);
    
    if (channel) {
      await channel.send(`📥 **${username}** joined the server.`);
      console.log(`📤 [Discord Sent] Announced JOIN for ${username}`);
    }

    // Broadcast event to api.sflightx.com subscribers
    broadcastToClients({ type: "PLAYER_JOIN", username });
    return;
  }

  // 3. CAPTURE PLAYER DISCONNECTS: "[Timestamp INFO] Player disconnected: edrek0729, xuid: ..."
  if (cleanLine.includes("Player disconnected:")) {
    const username = cleanLine.split("Player disconnected:")[1].split(",")[0].trim();
    
    console.log(`✅ [API Event] Captured LEAVE event for player: ${username}`);
    
    if (channel) {
      await channel.send(`📤 **${username}** left the server.`);
      console.log(`📤 [Discord Sent] Announced LEAVE for ${username}`);
    }

    // Broadcast event to api.sflightx.com subscribers
    broadcastToClients({ type: "PLAYER_LEAVE", username });
    return;
  }

  // 4. CAPTURE IN-GAME CHAT: Matches "<Username> Message"
  const chatMatch = cleanLine.match(/<([^>]+)>\s*(.+)/);
  if (chatMatch) {
    const player = chatMatch[1];
    const message = chatMatch[2];
    
    console.log(`✅ [API Event] Captured CHAT from ${player}: "${message}"`);

    if (channel) {
      await channel.send(`💬 **[In-Game] ${player}:** ${message}`);
      console.log(`📤 [Discord Sent] Forwarded chat message from ${player}`);
    }
    return;
  }

  // 5. CAPTURE DEATH MESSAGES
  const deathKeywords = [
    "was slain by", "drowned", "fell from a high place", "blew up",
    "burned to death", "tried to swim in lava", "was killed by", 
    "starved to death", "suffocated in a wall", "hit the ground too hard"
  ];

  if (deathKeywords.some(keyword => cleanLine.includes(keyword))) {
    // Clean out timestamp prefix for Discord display
    const cleanDeathMessage = cleanLine.replace(/^\[.*?\]\s*/, "");
    
    console.log(`✅ [API Event] Captured DEATH log: "${cleanDeathMessage}"`);

    if (channel) {
      await channel.send(`☠️ **Death Alert:** \`${cleanDeathMessage}\``);
      console.log(`📤 [Discord Sent] Sent Death Alert to Discord`);
    }

    // Broadcast death out to api.sflightx.com subscribers
    broadcastToClients({ type: "PLAYER_DEATH", message: cleanDeathMessage });
  }
}

// 1. Define Slash Commands
const commands = [
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Check status of the server and player count."),
].map((command) => command.toJSON());

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
    activities: [{ name: "VoidCraft SMP Console", type: 0 }],
  },
});

let isServerOnline = false;

// Handle events pushed manually or via /v1/broadcast
async function handleIncomingWsEvent(payload) {
  if (!CHANNEL_ID) return;
  const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
  if (!channel) return;

  if (payload.type === "INFLATION_UPDATE") {
    const inflationEmbed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle("📊 Market Inflation Update")
      .setDescription(`Current Rate: **${payload.rate}%**`)
      .addFields({ name: "Shift", value: `${payload.change || "0"}%`, inline: true })
      .setFooter({ text: "api.sflightx.com Economy Feed" })
      .setTimestamp();

    await channel.send({ embeds: [inflationEmbed] });
  }
}

// 3. Ready Event
client.once(Events.ClientReady, async (c) => {
  console.log(`🤖 Discord Bot Ready! Logged in as ${c.user.tag}`);
  await registerSlashCommands();
  
  // Start the Pterodactyl console listener
  connectToMCServerHost();

  // Status Watcher Poller
  const CHECK_INTERVAL = 30 * 1000;
  setInterval(async () => {
    const host = MC_SERVER_IP || "15.235.144.117";
    const port = MC_SERVER_PORT || 14902;

    try {
      const response = await axios.get(
        `https://api.mcstatus.io/v2/status/bedrock/${host}:${port}`
      );
      const data = response.data;

      if (data.online && !isServerOnline) {
        isServerOnline = true;
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
      } else if (!data.online && isServerOnline) {
        isServerOnline = false;
        const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
        if (channel) {
          const offlineEmbed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("Server just went OFFLINE")
            .setDescription("Contact an admin regarding server status.")
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

// 4. Interaction Handler
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

// Error handling
process.on("unhandledRejection", (reason) => console.error("Unhandled Rejection:", reason));
process.on("uncaughtException", (err) => console.error("Uncaught Exception:", err));

// 5. Start Server
server.listen(PORT, () => {
  console.log(`🚀 API & WebSocket Server running on port ${PORT}`);
});

const loginWithRetry = async (retries = 5, delay = 5000) => {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`🔑 Logging into Discord (Attempt ${i + 1}/${retries})...`);
      await client.login(DISCORD_TOKEN);
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