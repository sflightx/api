import express from "express";
import axios from "axios";
import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import dotenv from "dotenv";
dotenv.config();

const { DISCORD_TOKEN, CLIENT_ID, MC_SERVER_IP, MC_SERVER_PORT } = process.env;
const router = express.Router();
const app = express();

app.get("/", (req, res) => {
  res.status(200).json({ status: "online", message: "SFlightX and VoidCraft Discord Bot & API active!" });
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

const commands = [
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Check status of the server and player count.")
].map(command => command.toJSON());

export const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

//register ping commands
client.once(Events.ClientReady, async (c) => {
  console.log(`Ready! Logged in as ${c.user.tag}`);

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

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // Handle /status command
  if (commandName === "status") {
    // Acknowledge the interaction immediately to prevent 3-second timeouts
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

if (DISCORD_TOKEN) {
  client.login(DISCORD_TOKEN).catch((error) => {
    console.error("❌ Error logging in to Discord:", error);
  });
} else {
  console.error("❌ DISCORD_TOKEN is missing in environment variables!");
}

export default router;