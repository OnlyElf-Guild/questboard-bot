require("dotenv").config();
const http = require("http");
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  Events,
} = require("discord.js");
const { createClient } = require("@supabase/supabase-js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

let questMessageId = null;

client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot online als ${client.user.tag}`);
  await initQuestBoard();
});

async function initQuestBoard() {
  const channel = await client.channels.fetch(process.env.QUEST_CHANNEL_ID);

  const { data, error } = await supabase
    .from("bot_state")
    .select("*")
    .eq("key", "quest_board_message_id")
    .maybeSingle();

  if (error) {
    console.error("Fehler beim Laden von bot_state:", error);
  }

  if (data?.value) {
    questMessageId = data.value;
    try {
      const msg = await channel.messages.fetch(questMessageId);
      await renderBoard(msg);
      console.log("📜 Questboard gefunden & aktualisiert");
      return;
    } catch (e) {
      console.log("⚠️ Brett-Nachricht nicht mehr vorhanden -> wird neu erstellt");
    }
  }

  const newMsg = await channel.send({
    content: "📜 Lade Gildenauftragsbrett...",
  });

  questMessageId = newMsg.id;

  await supabase.from("bot_state").upsert({
    key: "quest_board_message_id",
    value: questMessageId,
  });

  await renderBoard(newMsg);
}

async function renderBoard(message) {
  const { data: quests, error } = await supabase
    .from("guild_quests")
    .select("*")
    .in("status", ["OPEN", "CLAIMED", "AWAITING_CONFIRMATION"])
    .order("id", { ascending: true });

  if (error) {
    console.error("Fehler beim Laden der Quests:", error);
    return;
  }

  const open = quests.filter((q) => q.status === "OPEN");
  const claimed = quests.filter((q) => q.status === "CLAIMED");
  const confirm = quests.filter((q) => q.status === "AWAITING_CONFIRMATION");

  const embed = new EmbedBuilder()
    .setTitle("📜 Gildenauftragsbrett")
    .setColor(0xc8a45d)
    .setDescription(buildBoardText(open, claimed, confirm))
    .setFooter({ text: "Aushangtafel der Gilde" });

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("create")
      .setLabel("📜 Aushang schreiben")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("guild")
      .setLabel("🏰 Gildenaushang")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("accept")
      .setLabel("🗡 Auftrag annehmen")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("refresh")
      .setLabel("🕯 Brett erneuern")
      .setStyle(ButtonStyle.Secondary)
  );

  await message.edit({
    content: "",
    embeds: [embed],
    components: [buttons],
  });
}

function buildBoardText(open, claimed, confirm) {
  let text = "";

  text += "╔════════ **Anschlagbrett** ════════╗\n";
  if (!open.length) {
    text += "_Zur Zeit haengt kein neuer Auftrag aus._\n";
  } else {
    open.forEach((q) => {
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
    claimed.forEach((q) => {
      text += `**#${q.id}**  ${q.amount}x ${q.title}\n`;
      text += `Abenteurer: ${q.claimed_by_name}\n\n`;
    });
  }
  text += "╚═══════════════════════════════════╝\n\n";

  text += "╔════════ **Zur Abnahme** ══════════╗\n";
  if (!confirm.length) {
    text += "_Keine Rueckkehr wartet auf Bestaetigung._\n";
  } else {
    confirm.forEach((q) => {
      text += `**#${q.id}**  ${q.amount}x ${q.title}\n`;
      text += `Abgegeben von: ${q.claimed_by_name}\n`;
      text += "Wartet auf Bestaetigung\n\n";
    });
  }
  text += "╚═══════════════════════════════════╝";

  return text;
}

function buildQuestModal(type = "NORMAL") {
  const isGuild = type === "GUILD";

  const modal = new ModalBuilder()
    .setCustomId(isGuild ? "modal_create_guild" : "modal_create_normal")
    .setTitle(isGuild ? "Gildenaushang" : "Aushang schreiben");

  const titleInput = new TextInputBuilder()
    .setCustomId("title")
    .setLabel("Was wird benötigt?")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100)
    .setPlaceholder("z. B. Trank der Jadeschlange");

  const amountInput = new TextInputBuilder()
    .setCustomId("amount")
    .setLabel("Menge")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(10)
    .setPlaceholder("z. B. 50");

  const rewardInput = new TextInputBuilder()
    .setCustomId("reward")
    .setLabel("Belohnung")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(100)
    .setPlaceholder("z. B. 1000 Gold");

  const noteInput = new TextInputBuilder()
    .setCustomId("note")
    .setLabel("Notiz")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(300)
    .setPlaceholder("Optionaler Hinweis");

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(amountInput),
    new ActionRowBuilder().addComponents(rewardInput),
    new ActionRowBuilder().addComponents(noteInput)
  );

  return modal;
}

function isLeitung(member) {
  return member.roles.cache.has(process.env.LEITUNG_ROLE_ID);
}

async function refreshBoard() {
  const channel = await client.channels.fetch(process.env.QUEST_CHANNEL_ID);
  const msg = await channel.messages.fetch(questMessageId);
  await renderBoard(msg);
}

async function userHasActiveQuest(userId) {
  const { data, error } = await supabase
    .from("guild_quests")
    .select("id, status")
    .eq("claimed_by_id", userId)
    .in("status", ["CLAIMED", "AWAITING_CONFIRMATION"]);

  if (error) {
    console.error("Fehler bei userHasActiveQuest:", error);
    return true;
  }

  return data.length > 0;
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId === "refresh") {
        await refreshBoard();
        await interaction.reply({
          content: "Das Brett wurde erneuert.",
          flags: 64,
        });
        return;
      }

      if (interaction.customId === "create") {
        await interaction.showModal(buildQuestModal("NORMAL"));
        return;
      }

      if (interaction.customId === "guild") {
        if (!isLeitung(interaction.member)) {
          await interaction.reply({
            content: "Nur die Leitung darf Gildenaushänge erstellen.",
            flags: 64,
          });
          return;
        }

        await interaction.showModal(buildQuestModal("GUILD"));
        return;
      }

      if (interaction.customId === "accept") {
        const hasActive = await userHasActiveQuest(interaction.user.id);
        if (hasActive) {
          await interaction.reply({
            content: "Du hast bereits einen aktiven Auftrag.",
            flags: 64,
          });
          return;
        }

        const { data: openQuests, error } = await supabase
          .from("guild_quests")
          .select("id, title, amount, guild_created, created_by_id")
          .eq("status", "OPEN")
          .order("id", { ascending: true })
          .limit(25);

        if (error) {
          console.error("Fehler beim Laden offener Aufträge:", error);
          await interaction.reply({
            content: "Die offenen Aufträge konnten nicht geladen werden.",
            flags: 64,
          });
          return;
        }

        const filtered = openQuests.filter((q) => {
          if (q.guild_created) return true;
          return q.created_by_id !== interaction.user.id;
        });

        if (!filtered.length) {
          await interaction.reply({
            content: "Es gibt aktuell keinen Auftrag, den du annehmen kannst.",
            flags: 64,
          });
          return;
        }

        const select = new StringSelectMenuBuilder()
          .setCustomId("select_accept_quest")
          .setPlaceholder("Wähle einen Auftrag")
          .addOptions(
            filtered.map((q) => ({
              label: `#${q.id} ${truncateLabel(`${q.amount}x ${q.title}`, 80)}`,
              value: String(q.id),
              description: q.guild_created
                ? "Gildenauftrag"
                : "Privater Auftrag",
            }))
          );

        const row = new ActionRowBuilder().addComponents(select);

        await interaction.reply({
          content: "Welchen Auftrag möchtest du annehmen?",
          components: [row],
          flags: 64,
        });
        return;
      }
    }

    if (interaction.isModalSubmit()) {
      if (
        interaction.customId !== "modal_create_normal" &&
        interaction.customId !== "modal_create_guild"
      ) {
        return;
      }

      const isGuildQuest = interaction.customId === "modal_create_guild";

      if (isGuildQuest && !isLeitung(interaction.member)) {
        await interaction.reply({
          content: "Nur die Leitung darf Gildenaushänge erstellen.",
          flags: 64,
        });
        return;
      }

      const title = interaction.fields.getTextInputValue("title").trim();
      const amountRaw = interaction.fields.getTextInputValue("amount").trim();
      const reward = interaction.fields.getTextInputValue("reward").trim();
      const note = interaction.fields.getTextInputValue("note").trim();

      const amount = Number(amountRaw);

      if (!title || !Number.isInteger(amount) || amount <= 0) {
        await interaction.reply({
          content: "Bitte gib einen gültigen Titel und eine ganze Menge größer als 0 an.",
          flags: 64,
        });
        return;
      }

      const payload = {
        type: isGuildQuest ? "GUILD" : "NORMAL",
        status: "OPEN",
        title,
        amount,
        reward: reward || null,
        note: note || null,
        created_by_id: interaction.user.id,
        created_by_name: interaction.user.displayName || interaction.user.username,
        guild_created: isGuildQuest,
      };

      const { data, error } = await supabase
        .from("guild_quests")
        .insert(payload)
        .select("id")
        .single();

      if (error) {
        console.error("Fehler beim Erstellen des Auftrags:", error);
        await interaction.reply({
          content: "Der Auftrag konnte nicht erstellt werden.",
          flags: 64,
        });
        return;
      }

      await refreshBoard();

      await interaction.reply({
        content: isGuildQuest
          ? `Der Gildenaushang #${data.id} wurde ans Brett geheftet.`
          : `Der Auftrag #${data.id} wurde ans Brett geheftet.`,
        flags: 64,
      });
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId !== "select_accept_quest") return;

      const questId = Number(interaction.values[0]);

      const hasActive = await userHasActiveQuest(interaction.user.id);
      if (hasActive) {
        await interaction.update({
          content: "Du hast bereits einen aktiven Auftrag.",
          components: [],
        });
        return;
      }

      const { data: quest, error } = await supabase
        .from("guild_quests")
        .select("*")
        .eq("id", questId)
        .eq("status", "OPEN")
        .single();

      if (error || !quest) {
        await interaction.update({
          content: "Dieser Auftrag ist nicht mehr verfügbar.",
          components: [],
        });
        return;
      }

      if (!quest.guild_created && quest.created_by_id === interaction.user.id) {
        await interaction.update({
          content: "Du kannst deinen eigenen Auftrag nicht annehmen.",
          components: [],
        });
        return;
      }

      const { error: updateError } = await supabase
        .from("guild_quests")
        .update({
          status: "CLAIMED",
          claimed_by_id: interaction.user.id,
          claimed_by_name: interaction.user.displayName || interaction.user.username,
          claimed_at: new Date().toISOString(),
        })
        .eq("id", questId)
        .eq("status", "OPEN");

      if (updateError) {
        console.error("Fehler beim Annehmen:", updateError);
        await interaction.update({
          content: "Der Auftrag konnte nicht angenommen werden.",
          components: [],
        });
        return;
      }

      await refreshBoard();

      await interaction.update({
        content: `Du hast Auftrag #${questId} angenommen.`,
        components: [],
      });
      return;
    }
  } catch (err) {
    console.error("Interaction-Fehler:", err);

    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: "Es ist ein Fehler aufgetreten.",
          flags: 64,
        }).catch(() => {});
      } else {
        await interaction.reply({
          content: "Es ist ein Fehler aufgetreten.",
          flags: 64,
        }).catch(() => {});
      }
    }
  }
});

function truncateLabel(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

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
