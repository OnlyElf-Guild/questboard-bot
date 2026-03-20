require("dotenv").config();
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
    .setColor(0xf1c40f)
    .setDescription(buildBoardText(open, claimed, confirm));

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("create").setLabel("➕ Auftrag erstellen").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("guild").setLabel("🏰 Gildenauftrag").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("accept").setLabel("🤝 Annehmen").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("refresh").setLabel("🔄 Aktualisieren").setStyle(ButtonStyle.Secondary)
  );

  await message.edit({
    content: "",
    embeds: [embed],
    components: [buttons]
  });
}

function buildBoardText(open, claimed, confirm) {
  let text = "";

  text += "🟢 **Offen**\n";
  if (!open.length) text += "_Keine Aufträge_\n";
  open.forEach(q => {
    text += `#${q.id} ${q.amount}x ${q.title} — ${q.reward || "keine Belohnung"}\n`;
  });

  text += "\n🟡 **In Bearbeitung**\n";
  if (!claimed.length) text += "_Keine_\n";
  claimed.forEach(q => {
    text += `#${q.id} ${q.title} — ${q.claimed_by_name}\n`;
  });

  text += "\n🔵 **Wartet auf Bestätigung**\n";
  if (!confirm.length) text += "_Keine_\n";
  confirm.forEach(q => {
    text += `#${q.id} ${q.title} — abgegeben von ${q.claimed_by_name}\n`;
  });

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

client.login(process.env.DISCORD_TOKEN);
