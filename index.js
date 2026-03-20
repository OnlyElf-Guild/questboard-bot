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
      text += formatQuestLine(q);
    });
  }
  text += "╚════════════════════════════════════╝\n\n";

  text += "╔════ **Ausgesandte Abenteurer** ════╗\n";
  if (!claimed.length) {
    text += "_Derzeit ist kein Abenteurer ausgesandt._\n";
  } else {
    claimed.forEach((q) => {
      text += formatQuestLine(q, { traveler: true });
    });
  }
  text += "╚════════════════════════════════════╝\n\n";

  text += "╔════ **Warten auf Nachnahme** ══════╗\n";
  if (!confirm.length) {
    text += "_Zur Zeit wartet kein Gesuch auf Bestaetigung._\n";
  } else {
    confirm.forEach((q) => {
      text += formatQuestLine(q, { confirmation: true });
    });
  }
  text += "╚════════════════════════════════════╝";

  return text;
}

function formatQuestLine(q, options = {}) {
  const creator = q.guild_created ? "Die Gilde" : q.created_by_name;
  const category = q.category || "Waren";
  let text = "";

  text += `**#${q.id} [${category}]** ${q.title}\n`;

  if (q.details) {
    text += `Bedarf: ${q.details}\n`;
  }

  if (q.reward) {
    text += `Lohn: ${q.reward}\n`;
  }

  if (options.traveler) {
    text += `Unterwegs: ${q.claimed_by_name}\n`;
  } else if (options.confirmation) {
    const confirmer = q.guild_created ? "Leitung" : q.created_by_name;
    text += `Versandt von: ${q.claimed_by_name}\n`;
    text += `Bestaetigung durch: ${confirmer}\n`;
  } else {
    text += `Ausgehaengt von: ${creator}\n`;
  }

  if (q.note) {
    text += `Notiz: ${q.note}\n`;
  }

  text += "\n";
  return text;
}

function buildQuestModal(type = "NORMAL", category = "Waren") {
  const isGuildQuest = type === "GUILD";

  const modal = new ModalBuilder()
    .setCustomId(
      isGuildQuest
        ? `modal_create_guild_${category.toLowerCase()}`
        : `modal_create_private_${category.toLowerCase()}`
    )
    .setTitle(isGuildQuest ? "Gildengesuch aushaengen" : "Privates Gesuch aushaengen");

  const titleInput = new TextInputBuilder()
    .setCustomId("title")
    .setLabel("Gesuch")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100)
    .setPlaceholder(
      category === "Gruppe"
        ? "z. B. Mogu Shan Heroisch"
        : "z. B. Trank der Jadeschlange"
    );

  const detailsInput = new TextInputBuilder()
    .setCustomId("details")
    .setLabel("Bedarf")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100)
    .setPlaceholder(
      category === "Gruppe"
        ? "z. B. 1 Tank und 2 DD"
        : "z. B. 50x oder 1 Stack"
    );

  const rewardInput = new TextInputBuilder()
    .setCustomId("reward")
    .setLabel("Belohnung")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(100)
    .setPlaceholder("z. B. 300 Gold oder Nachnahme");

  const noteInput = new TextInputBuilder()
    .setCustomId("note")
    .setLabel("Notiz")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(300)
    .setPlaceholder("Optionaler Hinweis");

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(detailsInput),
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

function truncateLabel(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId === "create") {
        const select = new StringSelectMenuBuilder()
          .setCustomId("select_quest_creation_type")
          .setPlaceholder("Welche Art von Gesuch moechtest du aushaengen?")
          .addOptions([
            {
              label: "Privates Gesuch",
              value: "private",
              description: "Ein Gesuch im eigenen Namen",
            },
            {
              label: "Gildengesuch",
              value: "guild",
              description: "Ein Gesuch im Namen der Gilde",
            },
          ]);

        const row = new ActionRowBuilder().addComponents(select);

        await interaction.reply({
          content: "Waehle zuerst, ob es ein privates oder ein Gildengesuch ist.",
          components: [row],
          flags: 64,
        });
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
          .select("id, title, category, details, guild_created, created_by_id")
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
              label: `#${q.id} [${q.category || "Waren"}] ${truncateLabel(q.title, 60)}`,
              value: String(q.id),
              description: truncateLabel(q.details || "Ohne weitere Angaben", 90),
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
              label: `#${q.id} [${q.category || "Waren"}] ${truncateLabel(q.title, 60)}`,
              value: String(q.id),
              description: truncateLabel(q.details || "Ohne weitere Angaben", 90),
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
      const privateMatch = interaction.customId.match(/^modal_create_private_(waren|gruppe|sonstiges)$/);
      const guildMatch = interaction.customId.match(/^modal_create_guild_(waren|gruppe|sonstiges)$/);

      if (!privateMatch && !guildMatch) {
        return;
      }

      const isGuildQuest = Boolean(guildMatch);
      const categoryRaw = isGuildQuest ? guildMatch[1] : privateMatch[1];
      const category =
        categoryRaw === "waren"
          ? "Waren"
          : categoryRaw === "gruppe"
          ? "Gruppe"
          : "Sonstiges";

      if (isGuildQuest && !isLeitung(interaction.member)) {
        await interaction.reply({
          content: "Nur die Leitung darf Gildengesuche aushaengen.",
          flags: 64,
        });
        return;
      }

      const title = interaction.fields.getTextInputValue("title").trim();
      const details = interaction.fields.getTextInputValue("details").trim();
      const reward = interaction.fields.getTextInputValue("reward").trim();
      const note = interaction.fields.getTextInputValue("note").trim();

      if (!title || !details) {
        await interaction.reply({
          content: "Bitte fuelle Gesuch und Bedarf aus.",
          flags: 64,
        });
        return;
      }

      const payload = {
        type: isGuildQuest ? "GUILD" : "NORMAL",
        status: "OPEN",
        category,
        title,
        details,
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
      if (interaction.customId === "select_quest_creation_type") {
        const questType = interaction.values[0];

        const categorySelect = new StringSelectMenuBuilder()
          .setCustomId(`select_quest_category_${questType}`)
          .setPlaceholder("Waehle die Kategorie")
          .addOptions([
            {
              label: "Waren",
              value: "waren",
              description: "Items, Mats, Flasks, Food, Crafting",
            },
            {
              label: "Gruppe",
              value: "gruppe",
              description: "Ini, Raid, Twinks, Dungeonhilfe",
            },
            {
              label: "Sonstiges",
              value: "sonstiges",
              description: "Alles, was sonst gebraucht wird",
            },
          ]);

        const row = new ActionRowBuilder().addComponents(categorySelect);

        await interaction.update({
          content: "Waehle nun die Kategorie des Gesuchs.",
          components: [row],
        });
        return;
      }

      if (
        interaction.customId === "select_quest_category_private" ||
        interaction.customId === "select_quest_category_guild"
      ) {
        const category = interaction.values[0];
        const isGuildQuest = interaction.customId.endsWith("_guild");

        if (isGuildQuest && !isLeitung(interaction.member)) {
          await interaction.update({
            content: "Nur die Leitung darf Gildengesuche aushaengen.",
            components: [],
          });
          return;
        }

        await interaction.showModal(
          buildQuestModal(isGuildQuest ? "GUILD" : "NORMAL", category === "waren" ? "Waren" : category === "gruppe" ? "Gruppe" : "Sonstiges")
        );
        return;
      }

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
        await interaction
          .followUp({
            content: "Es ist ein Fehler aufgetreten.",
            flags: 64,
          })
          .catch(() => {});
      } else {
        await interaction
          .reply({
            content: "Es ist ein Fehler aufgetreten.",
            flags: 64,
          })
          .catch(() => {});
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
