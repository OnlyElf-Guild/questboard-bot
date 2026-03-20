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

async function getQuestClaims(questId) {
  const { data, error } = await supabase
    .from("guild_quest_claims")
    .select("*")
    .eq("quest_id", questId)
    .in("status", ["CLAIMED", "AWAITING_CONFIRMATION", "DONE"])
    .order("claimed_at", { ascending: true });

  if (error) {
    console.error("Fehler beim Laden der Claims:", error);
    return [];
  }

  return data || [];
}

async function getActiveClaimsForQuest(questId) {
  const { data, error } = await supabase
    .from("guild_quest_claims")
    .select("*")
    .eq("quest_id", questId)
    .in("status", ["CLAIMED", "AWAITING_CONFIRMATION"])
    .order("claimed_at", { ascending: true });

  if (error) {
    console.error("Fehler beim Laden aktiver Claims:", error);
    return [];
  }

  return data || [];
}

async function getUserActiveNonGroupClaim(userId) {
  const { data, error } = await supabase
    .from("guild_quest_claims")
    .select(`
      *,
      guild_quests!inner (
        id,
        category,
        title
      )
    `)
    .eq("user_id", userId)
    .in("status", ["CLAIMED", "AWAITING_CONFIRMATION"]);

  if (error) {
    console.error("Fehler bei getUserActiveNonGroupClaim:", error);
    return null;
  }

  return (data || []).find((row) => row.guild_quests?.category !== "Gruppe") || null;
}

async function getUserActiveGroupClaim(userId) {
  const { data, error } = await supabase
    .from("guild_quest_claims")
    .select(`
      *,
      guild_quests!inner (
        id,
        category,
        title
      )
    `)
    .eq("user_id", userId)
    .in("status", ["CLAIMED", "AWAITING_CONFIRMATION"]);

  if (error) {
    console.error("Fehler bei getUserActiveGroupClaim:", error);
    return null;
  }

  return (data || []).find((row) => row.guild_quests?.category === "Gruppe") || null;
}

async function getUserClaimForQuest(userId, questId) {
  const { data, error } = await supabase
    .from("guild_quest_claims")
    .select("*")
    .eq("user_id", userId)
    .eq("quest_id", questId)
    .in("status", ["CLAIMED", "AWAITING_CONFIRMATION"])
    .maybeSingle();

  if (error) {
    console.error("Fehler bei getUserClaimForQuest:", error);
    return null;
  }

  return data || null;
}

async function refreshQuestStatusFromClaims(questId) {
  const { data: quest, error: questError } = await supabase
    .from("guild_quests")
    .select("*")
    .eq("id", questId)
    .single();

  if (questError || !quest) return;

  const claims = await getActiveClaimsForQuest(questId);

  let status = "OPEN";

  if (claims.length === 0) {
    status = "OPEN";
  } else {
    const hasClaimed = claims.some((c) => c.status === "CLAIMED");
    const hasAwaiting = claims.some((c) => c.status === "AWAITING_CONFIRMATION");

    if (hasAwaiting && !hasClaimed) {
      status = "AWAITING_CONFIRMATION";
    } else {
      status = "CLAIMED";
    }
  }

  await supabase
    .from("guild_quests")
    .update({ status })
    .eq("id", questId);
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

  const questsWithClaims = await Promise.all(
    quests.map(async (q) => {
      const claims = await getQuestClaims(q.id);
      return { ...q, claims };
    })
  );

  const open = questsWithClaims.filter((q) => q.status === "OPEN");
  const claimed = questsWithClaims.filter((q) => q.status === "CLAIMED");
  const confirm = questsWithClaims.filter((q) => q.status === "AWAITING_CONFIRMATION");

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

  if (category === "Gruppe") {
    const activeClaims = (q.claims || []).filter(
      (c) => c.status === "CLAIMED" || c.status === "AWAITING_CONFIRMATION"
    );
    const claimNames = activeClaims.map((c) => c.user_name);

    text += `Plaetze: ${claimNames.length}/${q.max_claims || 4} belegt\n`;

    if (claimNames.length) {
      text += `Teilnehmer: ${claimNames.join(", ")}\n`;
    }
  }

  if (options.traveler) {
    if (category !== "Gruppe") {
      const activeClaim = (q.claims || []).find((c) => c.status === "CLAIMED");
      if (activeClaim) {
        text += `Unterwegs: ${activeClaim.user_name}\n`;
      }
    }
  } else if (options.confirmation) {
    if (category !== "Gruppe") {
      const waitingClaim = (q.claims || []).find(
        (c) => c.status === "AWAITING_CONFIRMATION"
      );
      const confirmer = q.guild_created ? "Leitung" : q.created_by_name;
      if (waitingClaim) {
        text += `Versandt von: ${waitingClaim.user_name}\n`;
        text += `Bestaetigung durch: ${confirmer}\n`;
      }
    } else {
      const waitingClaimNames = (q.claims || [])
        .filter((c) => c.status === "AWAITING_CONFIRMATION")
        .map((c) => c.user_name);

      if (waitingClaimNames.length) {
        text += `Warten auf Bestaetigung: ${waitingClaimNames.join(", ")}\n`;
      }
    }
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
        const activeNonGroup = await getUserActiveNonGroupClaim(interaction.user.id);
        const activeGroup = await getUserActiveGroupClaim(interaction.user.id);

        const { data: openQuests, error } = await supabase
          .from("guild_quests")
          .select("id, title, category, details, guild_created, created_by_id, max_claims, status")
          .in("status", ["OPEN", "CLAIMED"])
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

        const enriched = await Promise.all(
          openQuests.map(async (q) => {
            const claims = await getActiveClaimsForQuest(q.id);
            return { ...q, claims };
          })
        );

        const filtered = enriched.filter((q) => {
          if (!q.guild_created && q.created_by_id === interaction.user.id) {
            return false;
          }

          const activeCount = q.claims.length;
          const maxClaims = q.max_claims || 1;

          if (activeCount >= maxClaims) {
            return false;
          }

          const alreadyJoined = q.claims.some((c) => c.user_id === interaction.user.id);
          if (alreadyJoined) {
            return false;
          }

          if (q.category === "Gruppe") {
            if (activeGroup) return false;
            return true;
          }

          if (activeNonGroup) return false;
          return true;
        });

        if (!filtered.length) {
          await interaction.reply({
            content: "Es gibt derzeit kein passendes Gesuch, das du annehmen kannst.",
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
              description:
                q.category === "Gruppe"
                  ? truncateLabel(
                      `${q.claims.length}/${q.max_claims || 4} belegt • ${q.details || "Ohne Angaben"}`,
                      90
                    )
                  : truncateLabel(q.details || "Ohne weitere Angaben", 90),
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
        const activeNonGroup = await getUserActiveNonGroupClaim(interaction.user.id);
        const activeGroup = await getUserActiveGroupClaim(interaction.user.id);

        const candidates = [activeNonGroup, activeGroup].filter(Boolean);

        if (!candidates.length) {
          await interaction.reply({
            content: "Du hast derzeit keinen aktiven Auftrag, den du als abgegeben melden kannst.",
            flags: 64,
          });
          return;
        }

        if (candidates.length === 1) {
          const claim = candidates[0];

          const { error: updateError } = await supabase
            .from("guild_quest_claims")
            .update({
              status: "AWAITING_CONFIRMATION",
              submitted_at: new Date().toISOString(),
            })
            .eq("id", claim.id)
            .eq("status", "CLAIMED");

          if (updateError) {
            console.error("Fehler beim Melden als abgegeben:", updateError);
            await interaction.reply({
              content: "Der Auftrag konnte nicht als abgegeben vermerkt werden.",
              flags: 64,
            });
            return;
          }

          await refreshQuestStatusFromClaims(claim.quest_id);
          await refreshBoard();

          await interaction.reply({
            content: `Dein Beitrag zu Gesuch #${claim.quest_id} wurde als abgegeben vermerkt.`,
            flags: 64,
          });
          return;
        }

        const select = new StringSelectMenuBuilder()
          .setCustomId("select_deliver_claim")
          .setPlaceholder("Welchen Auftrag moechtest du abgeben?")
          .addOptions(
            candidates.slice(0, 25).map((c) => ({
              label: `#${c.quest_id} [${c.guild_quests.category}] ${truncateLabel(c.guild_quests.title, 60)}`,
              value: String(c.id),
              description: truncateLabel(c.guild_quests.details || "Ohne weitere Angaben", 90),
            }))
          );

        const row = new ActionRowBuilder().addComponents(select);

        await interaction.reply({
          content: "Welchen aktiven Auftrag moechtest du als abgegeben markieren?",
          components: [row],
          flags: 64,
        });
        return;
      }

      if (interaction.customId === "complete") {
        const { data: quests, error } = await supabase
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

        const eligibleQuests = quests.filter((q) => {
          if (q.guild_created) return isLeitung(interaction.member);
          return q.created_by_id === interaction.user.id;
        });

        if (!eligibleQuests.length) {
          await interaction.reply({
            content: "Du kannst derzeit kein wartendes Gesuch als erledigt bestaetigen.",
            flags: 64,
          });
          return;
        }

        const select = new StringSelectMenuBuilder()
          .setCustomId("select_complete_quest")
          .setPlaceholder("Welches Gesuch moechtest du bestaetigen?")
          .addOptions(
            eligibleQuests.slice(0, 25).map((q) => ({
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
        max_claims: category === "Gruppe" ? 4 : 1,
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
          buildQuestModal(
            isGuildQuest ? "GUILD" : "NORMAL",
            category === "waren"
              ? "Waren"
              : category === "gruppe"
              ? "Gruppe"
              : "Sonstiges"
          )
        );
        return;
      }

      if (interaction.customId === "select_accept_quest") {
        const questId = Number(interaction.values[0]);

        const { data: quest, error } = await supabase
          .from("guild_quests")
          .select("*")
          .in("status", ["OPEN", "CLAIMED"])
          .eq("id", questId)
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

        const existingClaim = await getUserClaimForQuest(interaction.user.id, questId);
        if (existingClaim) {
          await interaction.update({
            content: "Du bist diesem Gesuch bereits zugeordnet.",
            components: [],
          });
          return;
        }

        const currentClaims = await getActiveClaimsForQuest(questId);
        const maxClaims = quest.max_claims || 1;

        if (currentClaims.length >= maxClaims) {
          await interaction.update({
            content: "Dieses Gesuch ist bereits voll besetzt.",
            components: [],
          });
          return;
        }

        if (quest.category === "Gruppe") {
          const activeGroup = await getUserActiveGroupClaim(interaction.user.id);
          if (activeGroup) {
            await interaction.update({
              content: "Du hast bereits einen aktiven Gruppenplatz.",
              components: [],
            });
            return;
          }
        } else {
          const activeNonGroup = await getUserActiveNonGroupClaim(interaction.user.id);
          if (activeNonGroup) {
            await interaction.update({
              content: "Du hast bereits einen aktiven Waren- oder Sonstiges-Auftrag.",
              components: [],
            });
            return;
          }
        }

        const { error: claimError } = await supabase
          .from("guild_quest_claims")
          .insert({
            quest_id: questId,
            user_id: interaction.user.id,
            user_name: interaction.member?.displayName || interaction.user.username,
            status: "CLAIMED",
            claimed_at: new Date().toISOString(),
          });

        if (claimError) {
          console.error("Fehler beim Annehmen:", claimError);
          await interaction.update({
            content: "Das Gesuch konnte nicht angenommen werden.",
            components: [],
          });
          return;
        }

        await refreshQuestStatusFromClaims(questId);
        await refreshBoard();

        await interaction.update({
          content:
            quest.category === "Gruppe"
              ? `Du hast einen Platz in Gesuch #${questId} uebernommen.`
              : `Du hast dich fuer Gesuch #${questId} verpflichtet.`,
          components: [],
        });
        return;
      }

      if (interaction.customId === "select_deliver_claim") {
        const claimId = Number(interaction.values[0]);

        const { data: claim, error } = await supabase
          .from("guild_quest_claims")
          .select("*")
          .eq("id", claimId)
          .eq("user_id", interaction.user.id)
          .eq("status", "CLAIMED")
          .single();

        if (error || !claim) {
          await interaction.update({
            content: "Dieser Auftrag kann nicht mehr als abgegeben markiert werden.",
            components: [],
          });
          return;
        }

        const { error: updateError } = await supabase
          .from("guild_quest_claims")
          .update({
            status: "AWAITING_CONFIRMATION",
            submitted_at: new Date().toISOString(),
          })
          .eq("id", claimId)
          .eq("status", "CLAIMED");

        if (updateError) {
          console.error("Fehler beim Abgeben des Claims:", updateError);
          await interaction.update({
            content: "Der Auftrag konnte nicht als abgegeben markiert werden.",
            components: [],
          });
          return;
        }

        await refreshQuestStatusFromClaims(claim.quest_id);
        await refreshBoard();

        await interaction.update({
          content: `Dein Beitrag zu Gesuch #${claim.quest_id} wurde als abgegeben vermerkt.`,
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

        const { data: waitingClaims, error: claimsError } = await supabase
          .from("guild_quest_claims")
          .select("*")
          .eq("quest_id", questId)
          .eq("status", "AWAITING_CONFIRMATION");

        if (claimsError || !waitingClaims.length) {
          await interaction.update({
            content: "Zu diesem Gesuch gibt es derzeit nichts zu bestaetigen.",
            components: [],
          });
          return;
        }

        const { error: doneError } = await supabase
          .from("guild_quest_claims")
          .update({
            status: "DONE",
            confirmed_at: new Date().toISOString(),
          })
          .eq("quest_id", questId)
          .eq("status", "AWAITING_CONFIRMATION");

        if (doneError) {
          console.error("Fehler beim Abschliessen des Gesuchs:", doneError);
          await interaction.update({
            content: "Das Gesuch konnte nicht abgeschlossen werden.",
            components: [],
          });
          return;
        }

        const remainingActiveClaims = await getActiveClaimsForQuest(questId);

        if (remainingActiveClaims.length === 0) {
          await supabase
            .from("guild_quests")
            .update({
              status: "DONE",
              confirmed_at: new Date().toISOString(),
            })
            .eq("id", questId);
        } else {
          await refreshQuestStatusFromClaims(questId);
        }

        await refreshBoard();

        await interaction.update({
          content:
            quest.category === "Gruppe"
              ? `Alle wartenden Rueckmeldungen fuer Gesuch #${questId} wurden bestaetigt.`
              : `Gesuch #${questId} wurde als erledigt bestaetigt.`,
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
