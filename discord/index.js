import {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
} from "discord.js";
import axios from "axios";
import dotenv from "dotenv";
import http from "http";

dotenv.config();

console.log("🚀 Starting VoidCraft Bot Process...");

const { DISCORD_TOKEN, MC_SERVER_IP, MC_SERVER_PORT, CHANNEL_ID } = process.env;

// Validate environment variables on startup
console.log("⚙️ Validating Environment Configuration:");
console.log(`   └─ MC_SERVER_IP: ${MC_SERVER_IP || "15.235.144.117 (Default)"}`);
console.log(`   └─ MC_SERVER_PORT: ${MC_SERVER_PORT || "14902 (Default)"}`);
console.log(`   └─ CHANNEL_ID: ${CHANNEL_ID ? "Loaded" : "❌ MISSING"}`);
console.log(`   └─ DISCORD_TOKEN: ${DISCORD_TOKEN ? "Loaded" : "❌ MISSING"}`);

// 1. Keep-Alive Server for Render Free Tier
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  console.log(`📡 [Keep-Alive] HTTP Request received from ${req.socket.remoteAddress}`);
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("VoidCraft Discord Bot is active!");
}).listen(PORT, () => {
  console.log(`🌐 [Keep-Alive] HTTP server listening on port ${PORT}`);
});

// 2. Initialize Discord Client
console.log("🤖 Initializing Discord Client...");
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

// 3. Polling & Status Watcher on Ready
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ [Discord] Client ready! Logged in as: ${c.user.tag} (ID: ${c.user.id})`);

  const host = MC_SERVER_IP || "15.235.144.117";
  const port = MC_SERVER_PORT || 14902;
  const CHECK_INTERVAL = 30 * 1000; // 30 seconds

  console.log(`📡 [Minecraft Status] Target server address: ${host}:${port}`);
  console.log(`⏱️ [Minecraft Status] Polling interval set to ${CHECK_INTERVAL / 1000} seconds.`);

  // Initialize status on startup
  console.log("🔄 [Minecraft Status] Performing initial status check...");
  try {
    const initialCheck = await axios.get(
      `https://api.mcstatus.io/v2/status/bedrock/${host}:${port}`
    );
    isServerOnline = initialCheck.data.online;
    console.log(`📡 [Minecraft Status] Initial state captured: ${isServerOnline ? "ONLINE 🟢" : "OFFLINE 🔴"}`);
  } catch (e) {
    console.warn("⚠️ [Minecraft Status] Could not fetch initial status. Defaulting state to OFFLINE.", e.message);
  }

  // Interval polling loop
  console.log("🔁 [Minecraft Status] Starting status watcher loop...");
  setInterval(async () => {
    console.log("🔍 [Watcher] Polling Minecraft server status...");

    try {
      if (!CHANNEL_ID) {
        console.warn("⚠️ [Watcher] Skipped check: CHANNEL_ID is not defined in environment variables.");
        return;
      }

      console.log(`🔍 [Watcher] Fetching Target Channel (${CHANNEL_ID})...`);
      const channel = await client.channels.fetch(CHANNEL_ID).catch((err) => {
        console.error(`❌ [Watcher] Failed to fetch channel ID ${CHANNEL_ID}:`, err.message);
        return null;
      });

      if (!channel) {
        console.warn("⚠️ [Watcher] Channel not found or inaccessible. Skipping loop.");
        return;
      }

      console.log(`🌐 [Watcher] Requesting API: https://api.mcstatus.io/v2/status/bedrock/${host}:${port}`);
      const response = await axios.get(
        `https://api.mcstatus.io/v2/status/bedrock/${host}:${port}`
      );
      const data = response.data;
      console.log(`📊 [Watcher] Response received. Server online state: ${data.online}`);

      // STATE TRANSITION: Server came ONLINE
      if (data.online && !isServerOnline) {
        isServerOnline = true;
        console.log("🟢 [Watcher Event] State transition: OFFLINE ➔ ONLINE. Sending Discord notification...");

        const onlineNotificationEmbed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle("Server is now ONLINE!")
          .setDescription("The server is available for players to join.")
          .addFields(
            {
              name: "🏷️ Version",
              value: `\`${data.version?.name || "Bedrock Edition"}\``,
              inline: true,
            },
            {
              name: "👥 Players",
              value: `\`${data.players.online} / ${data.players.max}\``,
              inline: true,
            }
          )
          .setFooter({ text: "Automated Server Status Watcher" })
          .setTimestamp();

        await channel.send({
          content: "<@&1543433357881507942>",
          embeds: [onlineNotificationEmbed],
          allowedMentions: { roles: ["1543433357881507942"] },
        });

        console.log("✅ [Watcher Event] ONLINE notification successfully dispatched!");
      }
      // STATE TRANSITION: Server went OFFLINE
      else if (!data.online && isServerOnline) {
        isServerOnline = false;
        console.log("🔴 [Watcher Event] State transition: ONLINE ➔ OFFLINE. Sending Discord notification...");

        const offlineNotificationEmbed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("Server just went OFFLINE")
          .setDescription(
            "Contact any admin regarding the server status. It may be undergoing maintenance or experiencing issues."
          )
          .setFooter({ text: "Automated Server Status Watcher" })
          .setTimestamp();

        await channel.send({ embeds: [offlineNotificationEmbed] });

        console.log("✅ [Watcher Event] OFFLINE notification successfully dispatched!");
      } else {
        console.log(`ℹ️ [Watcher] No state transition detected. (Current State: ${isServerOnline ? "ONLINE" : "OFFLINE"})`);
      }
    } catch (err) {
      console.error("❌ [Watcher Error] Poll failure during execution:", err.message);
    }
  }, CHECK_INTERVAL);
});

// 4. Slash Command Interaction Handler
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  console.log(`💬 [Interaction] Command "/${interaction.commandName}" triggered by ${interaction.user.tag} (${interaction.user.id}) in guild ${interaction.guildId}`);

  if (interaction.commandName === "status") {
    console.log("⏳ [Interaction] Deferring reply for /status command...");
    await interaction.deferReply();

    const host = MC_SERVER_IP || "15.235.144.117";
    const port = MC_SERVER_PORT || 14902;
    const startTime = Date.now();

    try {
      console.log(`🌐 [Interaction] Pinging Minecraft API for /status command...`);
      const response = await axios.get(
        `https://api.mcstatus.io/v2/status/bedrock/${host}:${port}`
      );
      const duration = Date.now() - startTime;
      const data = response.data;

      console.log(`📊 [Interaction] API ping complete in ${duration}ms. Online status: ${data.online}`);

      if (data.online) {
        const onlineEmbed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle("🟢 Server is ONLINE")
          .setDescription("The server is active and reachable.")
          .addFields(
            { name: "⚡ Latency", value: `\`${duration}ms\``, inline: true },
            {
              name: "👥 Players",
              value: `\`${data.players.online} / ${data.players.max}\``,
              inline: true,
            },
            {
              name: "🏷️ Version",
              value: `\`${data.version?.name || "Bedrock Edition"}\``,
              inline: false,
            }
          )
          .setFooter({ text: "VoidCraft SMP • Live Status" })
          .setTimestamp();

        await interaction.editReply({ embeds: [onlineEmbed] });
        console.log("✅ [Interaction] Responded to /status with ONLINE embed.");
      } else {
        const offlineEmbed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("🔴 Server is OFFLINE")
          .setDescription("Unable to establish a connection to the server.")
          .setFooter({ text: "VoidCraft SMP • Live Status" })
          .setTimestamp();

        await interaction.editReply({ embeds: [offlineEmbed] });
        console.log("✅ [Interaction] Responded to /status with OFFLINE embed.");
      }
    } catch (err) {
      console.error("❌ [Interaction Error] Command execution failed:", err.message);
      await interaction.editReply(
        "**Failed to ping server:** Could not fetch server status."
      );
    }
  }
});

// 5. Discord Connection Event Listeners
client.on(Events.Error, (err) => console.error("❌ [Discord Client Error]:", err.message));
client.on(Events.Warn, (info) => console.warn("⚠️ [Discord Client Warning]:", info));
client.on(Events.Debug, (message) => {
  // Useful for tracking raw connection logs if needed
  if (message.includes("Heartbeat") || message.includes("Latency")) {
    console.log(`🔍 [Discord Debug]: ${message}`);
  }
});

client.rest.on("rateLimited", (rateLimitInfo) => {
  console.warn(
    `⏳ [REST Rate Limit] Route: ${rateLimitInfo.route} | Retrying in: ${rateLimitInfo.timeToReset}ms | Global: ${rateLimitInfo.global}`
  );
});

// 6. Process Error Guardrails
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ [Process Error] Unhandled Rejection at:", promise, "Reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("❌ [Process Error] Uncaught Exception thrown:", err);
});

// 7. Login Execution with Exponential Backoff
const connectWithRetry = async (delay = 5000, maxDelay = 300000) => {
  if (!DISCORD_TOKEN) {
    console.error("❌ [Login Error] DISCORD_TOKEN is missing in environment variables!");
    return;
  }

  try {
    console.log("🔑 [Login] Attempting client.login()...");
    await client.login(DISCORD_TOKEN);
    console.log("✅ [Login] client.login() promise resolved successfully!");
  } catch (error) {
    console.error("❌ [Login Error] Login failed:", error.message);

    if (error.status === 429 || error.message.includes("429")) {
      console.warn(`⏳ [Login Rate Limit] Retrying connection in ${delay / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      const nextDelay = Math.min(delay * 2, maxDelay);
      return connectWithRetry(nextDelay, maxDelay);
    }
  }
};

connectWithRetry();