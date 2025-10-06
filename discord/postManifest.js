const express = require("express");
const cors = require("cors");
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const { DISCORD_TOKEN, CHANNEL_ID } = require("./initializeDiscord.js");

const app = express();
const PORT = process.env.PORT || 3000;

// Allow specific frontend origins (for CORS)
const allowedOrigins = [
  "https://sflightx.com",
  "https://api.sflightx.com",
  "https://app.sflightx.com",
  "https://help.sflightx.com",
  "http://127.0.0.1:5500",
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  }
}));

app.use(express.json());

// Preflight handling (for POST with JSON)
app.options("/discord/postManifest", cors());

app.post("/discord/postManifest", async (req, res) => {
  const {
    color, title, url, authorIconUrl, authorUrl, author,
    description, thumbnail, fields, imageUrl, footer, footerUrl
  } = req.body;

  if (!title || !description) {
    return res.status(400).json({ error: "Title and description are required." });
  }

  try {
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setTimestamp();

    // Helper to skip empty or invalid URL strings
    const safeUrl = (val) => (val && val.trim() !== "") ? val : undefined;

    if (color) embed.setColor(parseInt(color.replace("#", ""), 16));
    if (safeUrl(url)) embed.setURL(url);
    if (author) {
      if (safeUrl(authorIconUrl) || safeUrl(authorUrl)) {
        embed.setAuthor({
          name: author,
          iconURL: safeUrl(authorIconUrl),
          url: safeUrl(authorUrl),
        });
      } else {
        embed.setAuthor({ name: author });
      }
    }
    if (safeUrl(thumbnail)) embed.setThumbnail(thumbnail);
    if (fields?.length) embed.addFields(fields);
    if (safeUrl(imageUrl)) embed.setImage(imageUrl);
    if (footer) {
      embed.setFooter({
        text: footer,
        iconURL: safeUrl(footerUrl),
      });
    }

    const channel = await bot.channels.fetch(CHANNEL_ID);
    if (!channel?.isTextBased()) {
      return res.status(404).json({ error: "Invalid channel." });
    }

    await channel.send({ embeds: [embed] });
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Embed error:", err);
    res.status(500).json({ error: "Failed to send embed." });
  }

});

// Start the Discord bot
const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

bot.once("ready", () => console.log(`Bot ready as ${bot.user.tag}`));

if (!DISCORD_TOKEN) {
  console.error("Error: DISCORD_TOKEN is not defined.");
  process.exit(1);
} else {
  console.log("DISCORD_TOKEN is defined, logging in...");
  bot.login(DISCORD_TOKEN);
}

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
