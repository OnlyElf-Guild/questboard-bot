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

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

let questMessageId = null;

client.once(Events.ClientReady, async () => {
  try {
    console.log(`✅ Bot online als ${client.user.tag}`);
    await initQuestBoard();
  } catch (err) {
    console.error("FEHLER IN initQuestBoard:", err);
  }
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
    content: "📜 Lade Schwarzes Brett der Gilde...",
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
    console.error("Fehler beim Laden der Gesuche:", error);
    return;
  }

  const open = quests.filter((q) => q.status === "OPEN");
  const claimed = quests.filter((q) => q.status === "CLAIMED");
  const confirm = quests.filter((q) => q.status === "AWAITING_CONFIRMATION");

  const embed = new EmbedBuilder()
    .setTitle("📜 Schwarzes Brett der Gilde")
    .setColor(0x9b6b2f)
    .setDescription(buildBoardText(open, claimed, confirm))
    .setFooter({ text: "Aushang der Gildenhalle" });

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("create")
      .setLabel("📜 Gesuch aushaengen")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("accept")
      .setLabel("🗡 Auftrag annehmen")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("deliver")
      .setLabel("📦 Abgegeben")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("complete")
      .setLabel("✅ Auftrag erledigt")
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

  text += "╔════════ **Offene Gesuche** ════════╗\n";
  if (!open.length) {
    text += "_Zur Zeit haengt kein neues Gesuch aus._\n";
  } else {
    open.forEach((q) => {
      const creator = q.guild_created ? "Die Gilde" : q.created_by_name;
      text += `**#${q.id}**  ${q.amount}x ${q.title}\n`;
      text += `Lohn: ${q.reward || "nicht ausgeschrieben"}\n`;
      text += `Ausgehaengt von: ${creator}\n\n`;
    });
  }
  text += "╚════════════════════════════════════╝\n\n";

  text += "╔════ **Ausgesandte Abenteurer** ════╗\n";
  if (!claimed.length) {
    text += "_Derzeit ist kein Abenteurer ausgesandt._\n";
  } else {
    claimed.forEach((q) => {
      text += `**#${q.id}**  ${q.amount}x ${q.title}\n`;
      text += `Unterwegs: ${q.claimed_by_name}\n\n`;
    });
  }
  text += "╚════════════════════════════════════╝\n\n";

  text += "╔════ **Warten auf Nachnahme** ══════╗\n";
  if (!confirm.length) {
    text += "_Zur Zeit wartet kein Gesuch auf Bestaetigung._\n";
  } else {
    confirm.forEach((q) => {
      const confirmer = q.guild_created ? "Leitung" : q.created_by_name;
      text += `**#${q.id}**  ${q.amount}x ${q.title}\n`;
      text += `Versandt von: ${q.claimed_by_name}\n`;
      text += `Bestaetigung durch: ${confirmer}\n\n`;
    });
  }
  text += "╚════════════════════════════════════╝";

  return text;
}

function buildQuestModal() {
  const modal = new ModalBuilder()
    .setCustomId("modal_create_quest")
    .setTitle("Gesuch aushaengen");

  const titleInput = new TextInputBuilder()
    .setCustomId("title")
    .setLabel("Was wird benoetigt?")
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
    .setPlaceholder("z. B. 300 Gold");

  const typeInput = new TextInputBuilder()
    .setCustomId("quest_type")
    .setLabel("Typ: privat oder gilde")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(10)
    .setPlaceholder("privat");

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
    new ActionRowBuilder().addComponents(typeInput),
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

function truncateLabel(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId === "create") {
        await interaction.showModal(buildQuestModal());
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
          console.error("Fehler beim Laden offener Auftraege:", error);
          await interaction.reply({
            content: "Die offenen Gesuche konnten nicht geladen werden.",
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
            content: "Es gibt derzeit kein Gesuch, das du annehmen kannst.",
            flags: 64,
          });
          return;
        }

        const select = new StringSelectMenuBuilder()
          .setCustomId("select_accept_quest")
          .setPlaceholder("Waehle ein Gesuch")
          .addOptions(
            filtered.map((q) => ({
              label: `#${q.id} ${truncateLabel(`${q.amount}x ${q.title}`, 80)}`,
              value: String(q.id),
              description: q.guild_created
                ? "Gildengesuch"
                : "Privates Gesuch",
            }))
          );

        const row = new ActionRowBuilder().addComponents(select);

        await interaction.reply({
          content: "Welches Gesuch moechtest du annehmen?",
          components: [row],
          flags: 64,
        });
        return;
      }

      if (interaction.customId === "deliver") {
        const { data: activeQuest, error } = await supabase
          .from("guild_quests")
          .select("*")
          .eq("claimed_by_id", interaction.user.id)
          .eq("status", "CLAIMED")
          .maybeSingle();

        if (error) {
          console.error("Fehler beim Laden des aktiven Gesuchs:", error);
          await interaction.reply({
            content: "Dein laufendes Gesuch konnte nicht gefunden werden.",
            flags: 64,
          });
          return;
        }

        if (!activeQuest) {
          await interaction.reply({
            content: "Du hast derzeit keinen Auftrag, den du als abgegeben melden kannst.",
            flags: 64,
          });
          return;
        }

        const { error: updateError } = await supabase
          .from("guild_quests")
          .update({
            status: "AWAITING_CONFIRMATION",
            submitted_at: new Date().toISOString(),
          })
          .eq("id", activeQuest.id)
          .eq("status", "CLAIMED");

        if (updateError) {
          console.error("Fehler beim Melden als abgegeben:", updateError);
          await interaction.reply({
            content: "Der Auftrag konnte nicht als abgegeben vermerkt werden.",
            flags: 64,
          });
          return;
        }

        await refreshBoard();

        await interaction.reply({
          content: `Gesuch #${activeQuest.id} wurde als abgegeben vermerkt.`,
          flags: 64,
        });
        return;
      }

      if (interaction.customId === "complete") {
        const { data: waitingQuests, error } = await supabase
          .from("guild_quests")
          .select("*")
          .eq("status", "AWAITING_CONFIRMATION")
          .order("id", { ascending: true });

        if (error) {
          console.error("Fehler beim Laden wartender Gesuche:", error);
          await interaction.reply({
            content: "Die wartenden Gesuche konnten nicht geladen werden.",
            flags: 64,
          });
          return;
        }

        const eligible = waitingQuests.filter((q) => {
          if (q.guild_created) {
            return isLeitung(interaction.member);
          }
          return q.created_by_id === interaction.user.id;
        });

        if (!eligible.length) {
          await interaction.reply({
            content: "Du kannst derzeit kein wartendes Gesuch als erledigt bestaetigen.",
            flags: 64,
          });
          return;
        }

        if (eligible.length === 1) {
          const quest = eligible[0];

          const { error: doneError } = await supabase
            .from("guild_quests")
            .update({
              status: "DONE",
              confirmed_at: new Date().toISOString(),
            })
            .eq("id", quest.id)
            .eq("status", "AWAITING_CONFIRMATION");

          if (doneError) {
            console.error("Fehler beim Abschliessen des Gesuchs:", doneError);
            await interaction.reply({
              content: "Das Gesuch konnte nicht als erledigt markiert werden.",
              flags: 64,
            });
            return;
          }

          await refreshBoard();

          await interaction.reply({
            content: `Gesuch #${quest.id} wurde als erledigt bestaetigt.`,
            flags: 64,
          });
          return;
        }

        const select = new StringSelectMenuBuilder()
          .setCustomId("select_complete_quest")
          .setPlaceholder("Welches Gesuch ist erledigt?")
          .addOptions(
            eligible.slice(0, 25).map((q) => ({
              label: `#${q.id} ${truncateLabel(`${q.amount}x ${q.title}`, 80)}`,
              value: String(q.id),
              description: q.guild_created ? "Gildengesuch" : "Privates Gesuch",
            }))
          );

        const row = new ActionRowBuilder().addComponents(select);

        await interaction.reply({
          content: "Welches Gesuch moechtest du als erledigt bestaetigen?",
          components: [row],
          flags: 64,
        });
        return;
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId !== "modal_create_quest") return;

      const title = interaction.fields.getTextInputValue("title").trim();
      const amountRaw = interaction.fields.getTextInputValue("amount").trim();
      const reward = interaction.fields.getTextInputValue("reward").trim();
      const questTypeRaw = interaction.fields.getTextInputValue("quest_type").trim().toLowerCase();
      const note = interaction.fields.getTextInputValue("note").trim();

      const amount = Number(amountRaw);

      if (!title || !Number.isInteger(amount) || amount <= 0) {
        await interaction.reply({
          content: "Bitte gib einen gueltigen Titel und eine ganze Menge groesser als 0 an.",
          flags: 64,
        });
        return;
      }

      if (questTypeRaw !== "privat" && questTypeRaw !== "gilde") {
        await interaction.reply({
          content: "Beim Typ bitte nur 'privat' oder 'gilde' eintragen.",
          flags: 64,
        });
        return;
      }

      if (questTypeRaw === "gilde" && !isLeitung(interaction.member)) {
        await interaction.reply({
          content: "Nur die Leitung darf Gildengesuche aushaengen.",
          flags: 64,
        });
        return;
      }

      const isGuildQuest = questTypeRaw === "gilde";

      const payload = {
        type: isGuildQuest ? "GUILD" : "NORMAL",
        status: "OPEN",
        title,
        amount,
        reward: reward || null,
        note: note || null,
        created_by_id: interaction.user.id,
        created_by_name: interaction.member?.displayName || interaction.user.username,
        guild_created: isGuildQuest,
      };

      const { data, error } = await supabase
        .from("guild_quests")
        .insert(payload)
        .select("id")
        .single();

      if (error) {
        console.error("Fehler beim Erstellen des Gesuchs:", error);
        await interaction.reply({
          content: "Das Gesuch konnte nicht ausgehaengt werden.",
          flags: 64,
        });
        return;
      }

      await refreshBoard();

      await interaction.reply({
        content: isGuildQuest
          ? `Gildengesuch #${data.id} wurde am schwarzen Brett ausgehaengt.`
          : `Gesuch #${data.id} wurde am schwarzen Brett ausgehaengt.`,
        flags: 64,
      });
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "select_accept_quest") {
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
            content: "Dieses Gesuch ist nicht mehr verfuegbar.",
            components: [],
          });
          return;
        }

        if (!quest.guild_created && quest.created_by_id === interaction.user.id) {
          await interaction.update({
            content: "Du kannst dein eigenes Gesuch nicht annehmen.",
            components: [],
          });
          return;
        }

        const { error: updateError } = await supabase
          .from("guild_quests")
          .update({
            status: "CLAIMED",
            claimed_by_id: interaction.user.id,
            claimed_by_name: interaction.member?.displayName || interaction.user.username,
            claimed_at: new Date().toISOString(),
          })
          .eq("id", questId)
          .eq("status", "OPEN");

        if (updateError) {
          console.error("Fehler beim Annehmen:", updateError);
          await interaction.update({
            content: "Das Gesuch konnte nicht angenommen werden.",
            components: [],
          });
          return;
        }

        await refreshBoard();

        await interaction.update({
          content: `Du hast dich fuer Gesuch #${questId} verpflichtet.`,
          components: [],
        });
        return;
      }

      if (interaction.customId === "select_complete_quest") {
        const questId = Number(interaction.values[0]);

        const { data: quest, error } = await supabase
          .from("guild_quests")
          .select("*")
          .eq("id", questId)
          .eq("status", "AWAITING_CONFIRMATION")
          .single();

        if (error || !quest) {
          await interaction.update({
            content: "Dieses Gesuch steht nicht mehr zur Bestaetigung bereit.",
            components: [],
          });
          return;
        }

        const allowed = quest.guild_created
          ? isLeitung(interaction.member)
          : quest.created_by_id === interaction.user.id;

        if (!allowed) {
          await interaction.update({
            content: "Du darfst dieses Gesuch nicht als erledigt bestaetigen.",
            components: [],
          });
          return;
        }

        const { error: doneError } = await supabase
          .from("guild_quests")
          .update({
            status: "DONE",
            confirmed_at: new Date().toISOString(),
          })
          .eq("id", questId)
          .eq("status", "AWAITING_CONFIRMATION");

        if (doneError) {
          console.error("Fehler beim Abschliessen des Gesuchs:", doneError);
          await interaction.update({
            content: "Das Gesuch konnte nicht abgeschlossen werden.",
            components: [],
          });
          return;
        }

        await refreshBoard();

        await interaction.update({
          content: `Gesuch #${questId} wurde als erledigt bestaetigt.`,
          components: [],
        });
        return;
      }
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

const PORT = process.env.PORT || 10000;

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Questboard bot is running");
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`Health server listening on ${PORT}`);
  });

client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error("LOGIN FEHLER:", err);
});
