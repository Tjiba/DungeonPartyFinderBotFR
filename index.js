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
import fs from "fs";
import express from "express";
import registerCommands from "./deploy-commands.js";
dotenv.config();

await registerCommands();

// === CLIENT ===
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// === DATA ===
const partyData = new Map();
const CATA_FILE = "./cata.json";
let playerCataCache = fs.existsSync(CATA_FILE)
  ? new Map(Object.entries(JSON.parse(fs.readFileSync(CATA_FILE, "utf8"))))
  : new Map();

const saveCata = () =>
  fs.writeFileSync(CATA_FILE, JSON.stringify(Object.fromEntries(playerCataCache), null, 2));

// === EMBEDS ===
function createPartyEmbed(party) {
  const color = party.mode === "Master" ? 0x8b0000 : 0x00b36b;
  const modeEmoji = party.mode === "Master" ? "💀" : "⚔️";
  const floor = party.mode === "Master" ? `M${party.floor}` : `F${party.floor}`;
  const classIcons = { Berserker: "🗡️", Tank: "🛡️", Healer: "💚", Archer: "🏹", Mage: "🔥" };

  const members =
    party.members.length > 0
      ? party.members
          .map(
            (m) =>
              `> ${m.cata ? "🏅" : "⚠️"} <@${m.id}> — ${classIcons[m.class]} **${m.class}** ${
                m.cata ? `(Cata ${m.cata})` : "(non défini)"
              }`
          )
          .join("\n")
      : "_Aucun joueur inscrit._";

  const slots = party.size - party.members.length;
  const slotText = slots > 0 ? `🪶 **${slots} place${slots > 1 ? "s" : ""} restante${slots > 1 ? "s" : ""}**` : "✅ **Party complète !**";

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${modeEmoji} Recherche de Party — ${floor} [${party.members.length}/${party.size}]`)
    .setDescription(
      [
        `👑 **Chef :** <@${party.owner}>`,
        `⚔️ **Mode :** ${party.mode}`,
        `🏰 **Floor :** ${floor}`,
        `🎧 **Vocale :** ${party.vocal ? "✅" : "❌"}`,
        `🕒 **Heure :** ${party.time || "à définir"}`,
        "",
        "━━━━━━━━━━━━━━━",
        "📜 **Membres :**",
        members,
        "",
        slotText,
      ].join("\n")
    )
    .setFooter({ text: "⚙️ Niveau Catacombs enregistré localement (cache 24h)" });
}

function createCompleteEmbed(party) {
  const embed = createPartyEmbed(party);
  embed.setTitle("✅ Party complète !");
  embed.setColor(0x00b36b);
  embed.setFooter({ text: "Tous les membres sont prêts — invitez-vous en jeu." });
  return embed;
}

// === READY ===
client.once("ready", () => console.log(`✅ Connecté en tant que ${client.user.tag}`));

// === /PF ===
client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand() || i.commandName !== "pf") return;
  const modeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("mode_Normal").setLabel("⚔️ Normal").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("mode_Master").setLabel("💀 Master").setStyle(ButtonStyle.Danger)
  );
  await i.reply({ content: "Choisis ton **mode de donjon** 👇", components: [modeRow], ephemeral: true });
});

// === LOGIQUE PRINCIPALE ===
client.on("interactionCreate", async (i) => {
  if (!i.isButton() && i.type !== InteractionType.ModalSubmit) return;
  const uid = i.user.id;

  // === CHOIX MODE ===
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

  // === CHOIX FLOOR ===
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

  // === TAILLE ===
  if (i.customId.startsWith("size_")) {
    const [, size, owner] = i.customId.split("_");
    if (uid !== owner) return i.reply({ content: "❌ Seul le créateur peut choisir.", ephemeral: true });

    const p = partyData.get(owner);
    p.size = +size;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`vocal_yes_${owner}`).setLabel("🎧 Avec vocale").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`vocal_no_${owner}`).setLabel("🔇 Sans vocale").setStyle(ButtonStyle.Secondary)
    );
    return i.update({ content: "Souhaites-tu une **vocale** ?", components: [row] });
  }

  // === VOCALE ===
  if (i.customId.startsWith("vocal_")) {
    const [, type, owner] = i.customId.split("_");
    const p = partyData.get(owner);
    if (uid !== owner) return i.reply({ content: "❌ Seul le créateur peut choisir.", ephemeral: true });
    p.vocal = type === "yes";

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`time_now_${owner}`).setLabel("🕒 Maintenant").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`time_30_${owner}`).setLabel("⏳ Dans 30 min").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`time_60_${owner}`).setLabel("🕐 Dans 1h").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`time_custom_${owner}`).setLabel("🗓️ Autre").setStyle(ButtonStyle.Secondary)
    );
    return i.update({ content: "🕒 À quelle heure ?", components: [row] });
  }

  // === HEURE ===
  if (i.customId.startsWith("time_")) {
    const [, type, owner] = i.customId.split("_");
    const p = partyData.get(owner);
    if (uid !== owner) return i.reply({ content: "❌ Seul le créateur peut définir.", ephemeral: true });

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
    p.time =
      type === "now"
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

  // === CLASSE ===
  if (i.customId.startsWith("class_")) {
    const p = [...partyData.values()].find((x) => x.messageId === i.message.id);
    if (!p) return;

    const chosen = i.customId.split("_")[1];
    let m = p.members.find((m) => m.id === uid);
    if (!m) {
      if (p.members.length >= p.size) return i.reply({ content: "❌ Party complète !", ephemeral: true });
      const cached = playerCataCache.get(uid);
      m = { id: uid, class: chosen, cata: cached?.level || null };
      p.members.push(m);
    } else m.class = chosen;

    // Si pas de cata, demander
    if (!m.cata) {
      const modal = new ModalBuilder()
        .setCustomId(`modal_cata_${uid}_${p.messageId}`)
        .setTitle("🏅 Niveau Catacombs")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("cata_input").setLabel("Niveau Cata").setStyle(TextInputStyle.Short)
          )
        );
      return i.showModal(modal);
    }

    // Update embed
    await i.update({ embeds: [createPartyEmbed(p)] });

    // Si complète → delete + final embed
    if (p.members.length >= p.size) {
      const chan = await client.channels.fetch(i.channelId);
      const old = await chan.messages.fetch(p.messageId);
      await old.delete().catch(() => {});
      const tags = p.members.map((m) => `<@${m.id}>`).join(" ");
      await chan.send({
        content: `✅ **Party complète !**\n👥 ${tags}\n> <@${p.owner}> doit inviter tout le monde.`,
        embeds: [createCompleteEmbed(p)],
      });
      partyData.delete(p.owner);
    }
  }

  // === MODAL CATA ===
  if (i.type === InteractionType.ModalSubmit && i.customId.startsWith("modal_cata_")) {
    const [, , uid, msgId] = i.customId.split("_");
    const val = Number(i.fields.getTextInputValue("cata_input"));
    const p = [...partyData.values()].find((x) => x.messageId === msgId);
    if (!p) return;

    const m = p.members.find((x) => x.id === uid);
    if (m) {
      m.cata = val;
      playerCataCache.set(uid, { level: val, saved: Date.now() });
      saveCata();
    }

    const chan = await client.channels.fetch(i.channelId);
    const msg = await chan.messages.fetch(msgId);
    await msg.edit({ embeds: [createPartyEmbed(p)] });
    await i.reply({ content: "✅ Niveau enregistré.", ephemeral: true });

    if (p.members.length >= p.size) {
      await msg.delete().catch(() => {});
      const tags = p.members.map((m) => `<@${m.id}>`).join(" ");
      await chan.send({
        content: `✅ **Party complète !**\n👥 ${tags}\n> <@${p.owner}> doit inviter tout le monde.`,
        embeds: [createCompleteEmbed(p)],
      });
      partyData.delete(p.owner);
    }
  }

  // === QUITTER ===
  if (i.customId === "leave_party") {
    const p = [...partyData.values()].find((x) => x.messageId === i.message.id);
    if (!p) return;
    p.members = p.members.filter((m) => m.id !== uid);
    return i.update({ embeds: [createPartyEmbed(p)] });
  }

  // === SUPPRIMER ===
  if (i.customId === "delete_party") {
    const p = [...partyData.values()].find((x) => x.messageId === i.message.id);
    if (!p) return;
    if (uid !== p.owner) return i.reply({ content: "❌ Seul le créateur peut supprimer.", ephemeral: true });
    await i.message.delete().catch(() => {});
    partyData.delete(p.owner);
    return i.reply({ content: "🗑️ Party supprimée.", ephemeral: true });
  }
});

// === KEEP-ALIVE ===
const app = express();
app.get("/", (req, res) => res.send("Bot actif sur Render."));
app.listen(process.env.PORT || 3000, () => console.log("🌐 Keep-alive actif."));

client.login(process.env.TOKEN);
