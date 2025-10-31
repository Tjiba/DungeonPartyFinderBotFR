import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  InteractionType,
} from "discord.js";
import dotenv from "dotenv";
import fetch from "node-fetch";
import express from "express";
import registerCommands from "./deploy-commands.js";
dotenv.config();

await registerCommands();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// === CONVERSION CATACOMBS ===
// === CATACOMBS LVL — TABLE OFFICIELLE (NEU / Hypixel) ===
function getCataLevel(exp) {
  // XP requise par niveau Catacombs (non cumulée)
  const perLevel = [
    50, 75, 110, 160, 230, 330, 470, 670, 950, 1340,
    1890, 2665, 3760, 5260, 7380, 10300, 14400, 20000, 27600, 38000,
    52500, 71500, 97000, 132000, 180000, 243000, 328000, 445000, 600000, 800000,
    1_065_000, 1_410_000, 1_900_000, 2_500_000, 3_300_000, 4_300_000, 5_600_000, 7_200_000, 9_200_000, 12_000_000,
    15_000_000, 19_000_000, 24_000_000, 30_000_000, 38_000_000, 48_000_000, 60_000_000, 75_000_000, 93_000_000, 116_250_000
  ];

  // cumul
  const cumulative = [0];
  for (const xp of perLevel) cumulative.push(cumulative[cumulative.length - 1] + xp);
  const total50 = cumulative.at(-1);

  // Cas: joueur dépasse le total du niveau 50
  if (exp >= total50) return "50+";

  // Cas normal
  for (let i = 1; i < cumulative.length; i++) {
    if (exp < cumulative[i]) {
      const prev = cumulative[i - 1];
      const next = cumulative[i];
      const frac = (exp - prev) / (next - prev);
      return (i - 1 + frac).toFixed(2);
    }
  }

  return "0";
}


// === Récupération niveau via API HYPIXEL ===
// === RÉCUPÉRATION NIVEAU CATACOMBS VIA API HYPIXEL ===
async function getCataLevelFromName(discordUser) {
  try {
    // 1️⃣ Nettoyage du pseudo Discord
    const baseName =
      discordUser?.nickname?.replace(/\[.*?\]/g, "") ||
      discordUser?.user?.username ||
      "";
    const mcName = baseName.replace(/[^A-Za-z0-9_]/g, "").trim();

    if (!mcName) {
      console.log("⚠️ Aucun pseudo valide trouvé pour", baseName);
      return null;
    }

    let uuid = null;

    // 2️⃣ Conversion Mojang (pseudo → UUID)
    const mojangRes = await fetch(`https://api.mojang.com/users/profiles/minecraft/${mcName}`);
    if (mojangRes.ok) {
      const mojang = await mojangRes.json();
      uuid = mojang.id;
    } else {
      console.log(`⚠️ Mojang ne trouve pas ${mcName}`);
      return null;
    }

    // 3️⃣ Récupération du profil Hypixel
    const hypixelRes = await fetch(
      `https://api.hypixel.net/v2/skyblock/profiles?key=${process.env.HYPIXEL_KEY}&uuid=${uuid}`
    );
    const hypixel = await hypixelRes.json();

    if (!hypixel.success || !hypixel.profiles?.length) {
      console.log(`⚠️ Aucun profil Hypixel pour ${mcName}`);
      return null;
    }

    // 4️⃣ Sélection du profil actif (le plus récent, non bingo)
    const profiles = hypixel.profiles.filter((p) => p.game_mode !== "bingo");
    const activeProfile = profiles.reduce((a, b) =>
      (b.members?.[uuid]?.last_save || 0) > (a.members?.[uuid]?.last_save || 0) ? b : a
    );

    // 5️⃣ Récupération de l’XP Catacombs
    const exp = activeProfile.members?.[uuid]?.dungeons?.dungeon_types?.catacombs?.experience ?? 0;
    if (exp <= 0) {
      console.log(`⚠️ Aucun XP Catacombs pour ${mcName}`);
      return null;
    }

    // 6️⃣ Conversion en niveau
    const level = getCataLevel(exp);
    console.log(`✅ ${mcName}: ${exp} XP → Cata ${level}`);
    return level;
  } catch (err) {
    console.error("❌ Erreur Hypixel:", err);
    return null;
  }
}


// === PARTIE BOT ===
const partyData = new Map();

function createPartyEmbed(p) {
  const color = p.mode === "Master" ? 0x8b0000 : 0x00b36b;
  const floor = p.mode === "Master" ? `M${p.floor}` : `F${p.floor}`;
  const classIcons = { Berserker: "🗡️", Tank: "🛡️", Healer: "💚", Archer: "🏹", Mage: "🔥" };

  const members =
    p.members.length > 0
      ? p.members.map(
          (m) =>
            `> ${m.cata ? "🏅" : "⚠️"} <@${m.id}> — ${classIcons[m.class]} **${m.class}** ${
              m.cata ? `(Cata ${m.cata})` : "(non détecté)"
            }`
        ).join("\n")
      : "_Aucun joueur inscrit._";

  const slots = p.size - p.members.length;
  const slotText = slots > 0
    ? `🪶 **${slots} place${slots > 1 ? "s" : ""} restante${slots > 1 ? "s" : ""}**`
    : "✅ **Party complète !**";

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${p.mode === "Master" ? "💀" : "⚔️"} Recherche de Party — ${floor}`)
    .setDescription([
      `👑 **Chef :** <@${p.owner}>`,
      `🏰 **Floor :** ${floor}`,
      `🎧 **Vocale :** ${p.vocal ? "✅" : "❌"}`,
      `🕒 **Heure :** ${p.time || "à définir"}`,
      "",
      "━━━━━━━━━━━━━━━",
      "📜 **Membres :**",
      members,
      "",
      slotText
    ].join("\n"));
}

client.once("ready", () => console.log(`✅ Connecté en tant que ${client.user.tag}`));

client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand() || i.commandName !== "pf") return;
  await i.deferReply({ ephemeral: true });
  const modeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("mode_Normal").setLabel("⚔️ Normal").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("mode_Master").setLabel("💀 Master").setStyle(ButtonStyle.Danger)
  );
  await i.editReply({ content: "Choisis ton **mode de donjon** 👇", components: [modeRow] });
});

client.on("interactionCreate", async (i) => {
  if (!i.isButton() && i.type !== InteractionType.ModalSubmit) return;
  const uid = i.user.id;

  if (i.customId.startsWith("mode_")) {
    const mode = i.customId.split("_")[1];
    const rows = [new ActionRowBuilder(), new ActionRowBuilder()];
    for (let f = 1; f <= 7; f++) {
      const b = new ButtonBuilder()
        .setCustomId(`floor_${mode}_${f}`)
        .setLabel(`${mode === "Normal" ? "⚔️ F" : "💀 M"}${f}`)
        .setStyle(mode === "Normal" ? ButtonStyle.Success : ButtonStyle.Danger);
      (f <= 5 ? rows[0] : rows[1]).addComponents(b);
    }
    return i.update({ content: `Mode **${mode}** sélectionné. Choisis un floor :`, components: rows });
  }

  if (i.customId.startsWith("floor_")) {
    const [, mode, floor] = i.customId.split("_");
    const p = { owner: uid, mode, floor, size: 5, vocal: false, time: null, members: [] };
    partyData.set(uid, p);
    const sizeRow = new ActionRowBuilder();
    [2, 3, 4, 5].forEach((n) =>
      sizeRow.addComponents(
        new ButtonBuilder().setCustomId(`size_${n}_${uid}`).setLabel(`${n} joueurs`).setStyle(ButtonStyle.Primary)
      )
    );
    return i.update({ content: `Floor **${mode} ${floor}** sélectionné ! Taille ? 👇`, components: [sizeRow] });
  }

  if (i.customId.startsWith("size_")) {
    try {
      const [, size, owner] = i.customId.split("_");
      if (uid !== owner)
        return await i.reply({ content: "❌ Seul le créateur peut choisir.", ephemeral: true });

      await i.deferUpdate();

      const p = partyData.get(owner);
      p.size = +size;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`vocal_yes_${owner}`).setLabel("🎧 Avec vocale").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`vocal_no_${owner}`).setLabel("🔇 Sans vocale").setStyle(ButtonStyle.Secondary)
      );

      await i.editReply({ content: "Souhaites-tu une **vocale** ?", components: [row] });
    } catch (err) {
      console.error("Erreur interaction size_ :", err);
    }
  }

  if (i.customId.startsWith("vocal_")) {
    const [, type, owner] = i.customId.split("_");
    const p = partyData.get(owner);
    if (uid !== owner)
      return i.reply({ content: "❌ Seul le créateur peut choisir.", ephemeral: true });
    p.vocal = type === "yes";

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`time_now_${owner}`).setLabel("🕒 Maintenant").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`time_30_${owner}`).setLabel("⏳ Dans 30 min").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`time_60_${owner}`).setLabel("🕐 Dans 1h").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`time_custom_${owner}`).setLabel("🗓️ Autre").setStyle(ButtonStyle.Secondary)
    );
    return i.update({ content: "🕒 À quelle heure ?", components: [row] });
  }

  if (i.customId.startsWith("time_")) {
    const [, type, owner] = i.customId.split("_");
    const p = partyData.get(owner);
    if (!p) return;
    if (uid !== owner)
      return i.reply({ content: "❌ Seul le créateur peut définir.", ephemeral: true });

    if (type === "custom") {
      const modal = new ModalBuilder()
        .setCustomId(`modal_time_${owner}`)
        .setTitle("🕒 Heure personnalisée")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("time_input").setLabel("Heure (ex: 20h30)").setStyle(TextInputStyle.Short)
          )
        );
      return i.showModal(modal);
    }

    const now = new Date();
    if (type === "30") now.setMinutes(now.getMinutes() + 30);
    if (type === "60") now.setHours(now.getHours() + 1);
    p.time = type === "now"
      ? "Maintenant"
      : now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

    const classRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("class_Berserker").setLabel("🗡 Berserker").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("class_Tank").setLabel("🛡 Tank").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("class_Healer").setLabel("💚 Healer").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("class_Archer").setLabel("🏹 Archer").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("class_Mage").setLabel("🔥 Mage").setStyle(ButtonStyle.Danger)
    );

    const manageRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("leave_party").setLabel("🚪 Quitter").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("delete_party").setLabel("🗑️ Supprimer").setStyle(ButtonStyle.Danger)
    );

    const embed = createPartyEmbed(p);
    const msg = await i.channel.send({ embeds: [embed], components: [classRow, manageRow] });
    p.messageId = msg.id;
    return i.update({ content: "✅ Party créée !", components: [] });
  }

  if (i.type === InteractionType.ModalSubmit && i.customId.startsWith("modal_time_")) {
    const [, , owner] = i.customId.split("_");
    const p = partyData.get(owner);
    if (!p) return i.reply({ content: "Erreur de party.", ephemeral: true });
    const val = i.fields.getTextInputValue("time_input");
    p.time = val;

    const classRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("class_Berserker").setLabel("🗡 Berserker").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("class_Tank").setLabel("🛡 Tank").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("class_Healer").setLabel("💚 Healer").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("class_Archer").setLabel("🏹 Archer").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("class_Mage").setLabel("🔥 Mage").setStyle(ButtonStyle.Danger)
    );

    const manageRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("leave_party").setLabel("🚪 Quitter").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("delete_party").setLabel("🗑️ Supprimer").setStyle(ButtonStyle.Danger)
    );

    const embed = createPartyEmbed(p);
    const msg = await i.channel.send({ embeds: [embed], components: [classRow, manageRow] });
    p.messageId = msg.id;
    return i.reply({ content: `✅ Heure personnalisée définie sur ${val}`, ephemeral: true });
  }

  if (i.customId.startsWith("class_")) {
    const p = [...partyData.values()].find((x) => x.messageId === i.message.id);
    if (!p) return;
    const chosen = i.customId.split("_")[1];
    const existing = p.members.find((m) => m.id === uid);
    if (existing) {
      existing.class = chosen;
      await i.update({ embeds: [createPartyEmbed(p)] });
      return;
    }

    if (p.members.length >= p.size)
      return i.reply({ content: "❌ Party complète !", ephemeral: true });

    const cata = await getCataLevelFromName(i.member);
    p.members.push({ id: uid, class: chosen, cata });
    await i.update({ embeds: [createPartyEmbed(p)] });
  }

  if (i.customId === "leave_party") {
    const p = [...partyData.values()].find((x) => x.messageId === i.message.id);
    if (!p) return;
    p.members = p.members.filter((m) => m.id !== uid);
    return i.update({ embeds: [createPartyEmbed(p)] });
  }

  if (i.customId === "delete_party") {
    const p = [...partyData.values()].find((x) => x.messageId === i.message.id);
    if (!p) return;
    if (uid !== p.owner)
      return i.reply({ content: "❌ Seul le créateur peut supprimer.", ephemeral: true });
    await i.message.delete().catch(() => {});
    partyData.delete(p.owner);
    return i.reply({ content: "🗑️ Party supprimée.", ephemeral: true });
  }
});

const app = express();
app.get("/", (req, res) => res.send("Bot actif."));
app.listen(process.env.PORT || 3000, () => console.log("🌐 Keep-alive actif."));

client.login(process.env.TOKEN);
