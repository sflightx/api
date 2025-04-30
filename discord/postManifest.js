const express = require("express");
const cors = require("cors");
const path = require("path");
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const { DISCORD_TOKEN, CHANNEL_ID } = require("https://sflightx.com/resources/serviceAuth/initializeDiscord");

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = [
  "https://sflightx.com",
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
app.use("/manifest", express.static(path.join(__dirname, "manifest")));
app.use("/resources", express.static(path.join(__dirname, "resources")));
app.get("/", (_, res) => res.redirect("/manifest/index.html"));

app.post("/postManifest", async (req, res) => {
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

    if (color) embed.setColor(parseInt(color.replace("#", ""), 16));
    if (url) embed.setURL(url);
    if (author) embed.setAuthor({ name: author, iconURL: authorIconUrl, url: authorUrl });
    if (thumbnail) embed.setThumbnail(thumbnail);
    if (fields?.length) embed.addFields(fields);
    if (imageUrl) embed.setImage(imageUrl);
    if (footer) embed.setFooter({ text: footer, iconURL: footerUrl });

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
  res.send("Manifest received!");
});

const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
bot.once("ready", () => console.log(`Bot ready as ${bot.user.tag}`));
bot.login(DISCORD_TOKEN);

app.listen(PORT, () => console.log(`Server listening at http://localhost:${PORT}`));
