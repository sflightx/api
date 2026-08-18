import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
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
        await interaction.editReply(
          `🟢 **Minecraft Server Online!**\n` +
          `📡 **Address:** \`${host}:${port}\`\n` +
          `⚡ **Latency:** \`${duration}ms\`\n` +
          `👥 **Players:** \`${data.players.online}/${data.players.max}\`\n` +
          `🏷️ **Version:** \`${data.version?.name || "Bedrock"}\``
        );
      } else {
        await interaction.editReply(`🔴 **Server Offline:** \`${host}:${port}\` is unreachable.`);
      }
    } catch (err) {
      await interaction.editReply(`❌ **Failed to ping server:** Could not fetch status for \`${host}:${port}\`.`);
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
if (DISCORD_TOKEN) {
  client.login(DISCORD_TOKEN).catch((error) => {
    console.error("❌ Error logging in to Discord:", error);
  });
} else {
  console.error("❌ DISCORD_TOKEN is missing in environment variables!");
}