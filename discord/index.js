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

const { DISCORD_TOKEN, MC_SERVER_IP, MC_SERVER_PORT, CHANNEL_ID } = process.env;

// 1. Keep-Alive Server for Render Free Tier (Binds to PORT environment variable)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("VoidCraft Discord Bot is active!");
}).listen(PORT, () => {
  console.log(`🌐 Keep-alive server listening on port ${PORT}`);
});

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

// 3. Register Slash Commands & Polling on Ready
client.once(Events.ClientReady, async (c) => {
  console.log(`🤖 Discord Bot Ready! Logged in as ${c.user.tag}`);

  // Fetch target channel ONCE on startup and cache it
  let channel = null;
  if (CHANNEL_ID) {
    channel = await client.channels.fetch(CHANNEL_ID).catch((err) => {
      console.error("❌ Failed to fetch Discord channel:", err.message);
      return null;
    });
  }

  const host = MC_SERVER_IP || "15.235.144.117";
  const port = MC_SERVER_PORT || 14902;
  const CHECK_INTERVAL = 30 * 1000; // 30 seconds

  // Initialize status on startup without triggering a false online notification
  try {
    const initialCheck = await axios.get(
      `https://api.mcstatus.io/v2/status/bedrock/${host}:${port}`
    );
    isServerOnline = initialCheck.data.online;
    console.log(`📡 Initial server state captured: ${isServerOnline ? "ONLINE" : "OFFLINE"}`);
  } catch (e) {
    console.warn("⚠️ Could not fetch initial status. Defaulting to OFFLINE state.");
  }

  // Interval polling
  setInterval(async () => {
    try {
      const response = await axios.get(
        `https://api.mcstatus.io/v2/status/bedrock/${host}:${port}`
      );
      const data = response.data;

      // STATE TRANSITION: Server came ONLINE
      if (data.online && !isServerOnline) {
        isServerOnline = true;
        console.log("🟢 Server boot detected! Sending Discord announcement...");

        if (channel) {
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

          // Place the role mention in the main content parameter:
          await channel.send({
            content: "<@&1543433357881507942>",
            embeds: [onlineNotificationEmbed],
          });
        }
      }
      // STATE TRANSITION: Server went OFFLINE
      else if (!data.online && isServerOnline) {
        isServerOnline = false;
        console.log("🔴 Server shutdown detected.");

        if (channel) {
          const offlineNotificationEmbed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("Server just went OFFLINE")
            .setDescription(
              "Contact any admin regarding the server status. It may be undergoing maintenance or experiencing issues."
            )
            .setFooter({ text: "Automated Server Status Watcher" })
            .setTimestamp();

          await channel.send({ embeds: [offlineNotificationEmbed] });
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
      await interaction.editReply(
        "**Failed to ping server:** Could not fetch server status."
      );
    }
  }
});

// 5. Discord Connection Event Listeners
client.on(Events.Error, (err) => console.error("⚠️ Discord Client Error:", err.message));
client.on(Events.Warn, (info) => console.warn("⚠️ Discord Client Warning:", info));

client.rest.on("rateLimited", (rateLimitInfo) => {
  console.warn(
    `⏳ REST Rate limited on route ${rateLimitInfo.route}. Retrying in ${rateLimitInfo.timeToReset}ms...`
  );
});

// 6. Process Error Guardrails
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception thrown:", err);
});

// 7. Login Execution with Exponential Backoff
const connectWithRetry = async (delay = 5000, maxDelay = 300000) => {
  if (!DISCORD_TOKEN) {
    console.error("❌ DISCORD_TOKEN is missing in environment variables!");
    return;
  }

  try {
    console.log("🔑 Attempting client.login()...");
    await client.login(DISCORD_TOKEN);
  } catch (error) {
    console.error("❌ Login failed:", error.message);

    if (error.status === 429 || error.message.includes("429")) {
      console.warn(`⏳ Cloudflare Rate-limited. Retrying connection in ${delay / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      const nextDelay = Math.min(delay * 2, maxDelay);
      return connectWithRetry(nextDelay, maxDelay);
    }
  }
};

connectWithRetry();