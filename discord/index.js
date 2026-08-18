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

dotenv.config();

const { DISCORD_TOKEN, CLIENT_ID, MC_SERVER_IP, MC_SERVER_PORT } = process.env;

// 1. Define Slash Commands
const commands = [
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Check status of the server and player count.")
].map((command) => command.toJSON());

// 2. Initialize Discord Client
export const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  presence: {
    status: 'online',
    activities: [{
      name: '/Checking status of VoidCraft SMP',
      type: 0 // Playing
    }]
  }
});

// 3. Register Slash Commands on Ready
client.once(Events.ClientReady, async (c) => {
  console.log(`🤖 Discord Bot Ready! Logged in as ${c.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  try {
    console.log("Started refreshing application (/) commands.");

    await rest.put(
      Routes.applicationCommands(CLIENT_ID || c.user.id),
      { body: commands }
    );

    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error("Failed to register slash commands:", error);
  }
});

// 4. Interaction Handler and Checking
axios.get("https://discord.com/api/v10/gateway")
  .then(res => console.log("🌐 Discord Gateway reachable:", res.data.url))
  .catch(err => console.error("❌ Discord Network Error:", err.message));

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === "status") {
    await interaction.deferReply();

    const host = MC_SERVER_IP || "voidcraftsmp.mcsh.io";
    const port = MC_SERVER_PORT || 19132;
    const startTime = Date.now();

    try {
      const response = await axios.get(`https://api.mcstatus.io/v2/status/bedrock/${host}:${port}`);
      const duration = Date.now() - startTime;
      const data = response.data;

      if (data.online) {
        const onlineEmbed = new EmbedBuilder()
          .setColor(0x2ecc71) // Green status bar
          .setTitle("🟢 Server is ONLINE")
          .setDescription("The VoidCraft Minecraft Bedrock server is active and reachable.")
          .addFields(
            { name: "📡 Server", value: `\`${host}:${port}\``, inline: true },
            { name: "⚡ Latency", value: `\`${duration}ms\``, inline: true },
            { name: "👥 Player Count", value: `\`${data.players.online} / ${data.players.max}\``, inline: true },
            { name: "🏷️ Server Version", value: `\`${data.version?.name || "Bedrock Edition"}\``, inline: false }
          )
          .setFooter({ text: "VoidCraft SMP • Live Status" })
          .setTimestamp();

        await interaction.editReply({ embeds: [onlineEmbed] });
      } else {
        const offlineEmbed = new EmbedBuilder()
          .setColor(0xe74c3c) // Red status bar
          .setTitle("🔴 Server is OFFLINE")
          .setDescription(`Unable to establish a connection to \`${host}:${port}\`.`)
          .addFields(
            { name: "Status", value: "Offline / Unreachable", inline: true },
            { name: "Server Address", value: `\`${host}:${port}\``, inline: true }
          )
          .setFooter({ text: "VoidCraft SMP • Live Status" })
          .setTimestamp();

        await interaction.editReply({ embeds: [offlineEmbed] });
      }
    } catch (err) {
      await interaction.editReply(`**Failed to ping server:** Could not fetch status for \`${host}:${port}\`.`);
    }
  }
});

// Prevent process crashes from unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception thrown:", err);
});

console.log("🔍 Checking DISCORD_TOKEN presence:", DISCORD_TOKEN ? "EXISTS (Length: " + DISCORD_TOKEN.length + ")" : "MISSING/UNDEFINED");

// 5. Login to Discord
const loginWithRetry = async (retries = 5, delay = 5000) => {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`🔑 Attempting client.login() (Attempt ${i + 1}/${retries})...`);
      await client.login(DISCORD_TOKEN);
      console.log("✅ client.login() connected successfully!");
      return; // Exit loop on success
    } catch (error) {
      console.error(`❌ Login attempt ${i + 1} failed:`, error.message);

      // If rate limited (HTTP 429), wait before retrying
      if (error.status === 429 || error.message.includes("429")) {
        console.warn(`⏳ Rate-limited by Discord. Retrying in ${delay / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff (5s, 10s, 20s...)
      } else {
        // Non-rate-limit error (e.g., bad token), break immediately
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