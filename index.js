require("dotenv").config();
const http = require("http");
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const { createClient } = require("@supabase/supabase-js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

let questMessageId = null;

client.once("ready", async () => {
  console.log(`✅ Bot online als ${client.user.tag}`);

  await initQuestBoard();
});

async function initQuestBoard() {
  const channel = await client.channels.fetch(process.env.QUEST_CHANNEL_ID);

  const { data } = await supabase
    .from("bot_state")
    .select("*")
    .eq("key", "quest_board_message_id")
    .single();

  if (data) {
    questMessageId = data.value;
    try {
      const msg = await channel.messages.fetch(questMessageId);
      await renderBoard(msg);
      console.log("📜 Questboard gefunden & aktualisiert");
      return;
    } catch (e) {
      console.log("⚠️ Brett Nachricht nicht mehr vorhanden → wird neu erstellt");
    }
  }

  const newMsg = await channel.send({
    content: "📜 Lade Gildenauftragsbrett..."
  });

  questMessageId = newMsg.id;

  await supabase.from("bot_state").upsert({
    key: "quest_board_message_id",
    value: questMessageId
  });

  await renderBoard(newMsg);
}

async function renderBoard(message) {
  const { data: quests } = await supabase
    .from("guild_quests")
    .select("*")
    .neq("status", "DONE")
    .order("id");

  const open = quests.filter(q => q.status === "OPEN");
  const claimed = quests.filter(q => q.status === "CLAIMED");
  const confirm = quests.filter(q => q.status === "AWAITING_CONFIRMATION");

  const embed = new EmbedBuilder()
    .setTitle("📜 Gildenauftragsbrett")
    .setColor(0xc8a45d)
    .setDescription(buildBoardText(open, claimed, confirm))
    .setFooter({ text: "Aushangtafel der Gilde" });

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("create").setLabel("📜 Aushang schreiben").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("guild").setLabel("🏰 Gildenaushang").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("accept").setLabel("🗡 Auftrag annehmen").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("refresh").setLabel("🕯 Brett erneuern").setStyle(ButtonStyle.Secondary)
  );

  await message.edit({
    content: "",
    embeds: [embed],
    components: [buttons]
  });
}

function buildBoardText(open, claimed, confirm) {
  let text = "";

  text += "╔════════ **Anschlagbrett** ════════╗\n";
  if (!open.length) {
    text += "_Zur Zeit haengt kein neuer Auftrag aus._\n";
  } else {
    open.forEach(q => {
      const creator = q.guild_created ? "Die Gilde" : q.created_by_name;
      text += `**#${q.id}**  ${q.amount}x ${q.title}\n`;
      text += `Belohnung: ${q.reward || "keine"}\n`;
      text += `Ausgehängt von: ${creator}\n\n`;
    });
  }
  text += "╚═══════════════════════════════════╝\n\n";

  text += "╔════════ **Auf Reisen** ═══════════╗\n";
  if (!claimed.length) {
    text += "_Derzeit ist kein Abenteurer ausgesandt._\n";
  } else {
    claimed.forEach(q => {
      text += `**#${q.id}**  ${q.amount}x ${q.title}\n`;
      text += `Abenteurer: ${q.claimed_by_name}\n\n`;
    });
  }
  text += "╚═══════════════════════════════════╝\n\n";

  text += "╔════════ **Zur Abnahme** ══════════╗\n";
  if (!confirm.length) {
    text += "_Keine Rueckkehr wartet auf Bestaetigung._\n";
  } else {
    confirm.forEach(q => {
      text += `**#${q.id}**  ${q.amount}x ${q.title}\n`;
      text += `Abgegeben von: ${q.claimed_by_name}\n`;
      text += `Wartet auf Bestaetigung\n\n`;
    });
  }
  text += "╚═══════════════════════════════════╝";

  return text;
}

client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "refresh") {
    const channel = await client.channels.fetch(process.env.QUEST_CHANNEL_ID);
    const msg = await channel.messages.fetch(questMessageId);
    await renderBoard(msg);
    await interaction.reply({ content: "Brett aktualisiert ✅", ephemeral: true });
  }

  if (interaction.customId === "create") {
    await interaction.reply({ content: "Auftrag erstellen kommt als nächstes 🙂", ephemeral: true });
  }

  if (interaction.customId === "guild") {
    await interaction.reply({ content: "Gildenauftrag Funktion folgt 🙂", ephemeral: true });
  }

  if (interaction.customId === "accept") {
    await interaction.reply({ content: "Annehmen Funktion folgt 🙂", ephemeral: true });
  }
});
const PORT = process.env.PORT || 10000;

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Questboard bot is running");
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`Health server listening on ${PORT}`);
  });
client.login(process.env.DISCORD_TOKEN);
