/**
 * === DISCORD DUNGEON PARTY FINDER — Hypixel SkyBlock ===
 * --------------------------------------------------------
 * Objectif :
 *   → Créer des Party Finder automatiques pour les donjons SkyBlock
 *   → Récupérer le niveau Catacombs d’un joueur via l’API Hypixel
 *   → Gérer les classes, l’horaire, la taille, la vocale et la fermeture auto
 *
 * Dépendances :
 *   - discord.js  → interactions (slash, boutons, embeds...)
 *   - node-fetch  → appels API Mojang + Hypixel
 *   - express     → serveur keep-alive pour hébergement (Render / Railway)
 *   - dotenv      → variables d’environnement (TOKEN, CLIENT_ID, GUILD_ID, HYPIXEL_KEY)
 */

import {
  Client, GatewayIntentBits, EmbedBuilder,
  ButtonBuilder, ActionRowBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType
} from "discord.js";
import dotenv from "dotenv";
import fetch from "node-fetch";
import express from "express";
import registerCommands from "./deploy-commands.js";

dotenv.config();
await registerCommands(); // Enregistre /pf automatiquement

/* ============================
   1. INITIALISATION DU CLIENT
   ============================ */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

/* ======================================================
   2. CALCUL DU NIVEAU CATACOMBS SELON L’XP (LVL 1 → 50)
   ====================================================== */
function getCataLevel(exp) {
  const perLevel = [
    50,75,110,160,230,330,470,670,950,1340,1890,2665,3760,5260,7380,10300,14400,20000,27600,38000,
    52500,71500,97000,132000,180000,243000,328000,445000,600000,800000,
    1065000,1410000,1900000,2500000,3300000,4300000,5600000,7200000,9200000,12000000,
    15000000,19000000,24000000,30000000,38000000,48000000,60000000,75000000,93000000,116250000
  ];

  const total = perLevel.reduce((a, b) => a + b, 0);
  if (exp >= total) return "50+"; // Si dépasse XP max → 50+

  let acc = 0;
  for (let i = 0; i < perLevel.length; i++) {
    acc += perLevel[i];
    if (exp < acc) {
      const prev = acc - perLevel[i];
      const fraction = (exp - prev) / perLevel[i];
      return (i + fraction).toFixed(2);
    }
  }
  return "0";
}

/* =====================================================
   3. RÉCUPÉRATION DU NIVEAU CATACOMBS VIA API HYPIXEL
   ===================================================== */
async function getCataLevelFromName(member) {
  try {
    // Essaye d’extraire un pseudo Minecraft valide depuis le pseudo Discord
    const mcName = (member?.nickname || member?.user?.username || "")
      .replace(/\[.*?\]|[^A-Za-z0-9_]/g, "")
      .trim();
    if (!mcName) return null;

    // Étape 1 : Mojang → obtenir UUID du joueur
    const mojang = await (await fetch(`https://api.mojang.com/users/profiles/minecraft/${mcName}`)).json();
    const uuid = mojang.id;

    // Étape 2 : Hypixel → récupérer les profils SkyBlock
    const hypixel = await (await fetch(
      `https://api.hypixel.net/v2/skyblock/profiles?key=${process.env.HYPIXEL_KEY}&uuid=${uuid}`
    )).json();

    if (!hypixel.success || !hypixel.profiles?.length) return null;

    // Garde le profil le plus récent (non-bingo)
    const profiles = hypixel.profiles.filter(p => p.game_mode !== "bingo");
    const active = profiles.reduce((a, b) =>
      (b.members?.[uuid]?.last_save || 0) > (a.members?.[uuid]?.last_save || 0) ? b : a
    );

    // Cherche l’XP Catacombs du joueur
    const exp = active.members?.[uuid]?.dungeons?.dungeon_types?.catacombs?.experience ?? 0;
    return exp > 0 ? getCataLevel(exp) : null;
  } catch {
    return null;
  }
}

/* ========================================
   4. STRUCTURE DES DONNÉES DE CHAQUE PARTY
   ======================================== */
const partyData = new Map(); // Map(userId → infos party)

// Construit l’embed d’une party
function buildEmbed(p) {
  const color = p.mode === "Master" ? 0x8b0000 : 0x00b36b;
  const floor = `${p.mode === "Master" ? "M" : "F"}${p.floor}`;
  const icons = { Berserker:"🗡️", Tank:"🛡️", Healer:"💚", Archer:"🏹", Mage:"🔥" };

  const members = p.members.length
    ? p.members.map(m =>
      `> ${m.cata ? "🏅" : "⚠️"} <@${m.id}> — ${icons[m.class]} **${m.class}** ${m.cata ? `(Cata ${m.cata})` : "(non trouvé)"}`
    ).join("\n")
    : "_Aucun joueur inscrit._";

  const slots = p.size - p.members.length;
  const slotTxt = slots > 0
    ? `🪶 **${slots} place${slots>1?"s":""} restante${slots>1?"s":""}**`
    : "✅ **Party complète !**";

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${p.mode==="Master"?"💀":"⚔️"} Recherche de Party — ${floor}`)
    .setDescription([
      `👑 **Chef :** <@${p.owner}>`,
      `🏰 **Floor :** ${floor}`,
      `🎧 **Vocale :** ${p.vocal ? "✅" : "❌"}`,
      `🕒 **Heure :** ${p.time || "à définir"}`,
      "",
      "━━━━━━━━━━━━━━━",
      "📜 **Membres :**",
      members, "", slotTxt
    ].join("\n"));
}

/* ========================
   5. ÉVÉNEMENTS DU BOT
   ======================== */
client.once("ready", () => console.log(`✅ Connecté en tant que ${client.user.tag}`));

/* --- Étape 1 : Commande /pf --- */
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand() || i.commandName !== "pf") return;

  await i.deferReply({ ephemeral: true });
  const modeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("mode_Normal").setLabel("⚔️ Normal").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("mode_Master").setLabel("💀 Master").setStyle(ButtonStyle.Danger)
  );
  await i.editReply({ content: "Choisis ton **mode de donjon** 👇", components: [modeRow] });
});

/* --- Étape 2 → 7 : Boutons + Modales --- */
client.on("interactionCreate", async i => {
  if (!i.isButton() && i.type !== InteractionType.ModalSubmit) return;
  const uid = i.user.id;

  // (1) Choix du mode (Normal / Master)
  if (i.customId.startsWith("mode_")) {
    const mode = i.customId.split("_")[1];
    const rows = [new ActionRowBuilder(), new ActionRowBuilder()];
    for (let f=1; f<=7; f++) {
      const btn = new ButtonBuilder()
        .setCustomId(`floor_${mode}_${f}`)
        .setLabel(`${mode==="Normal"?"⚔️ F":"💀 M"}${f}`)
        .setStyle(mode==="Normal"?ButtonStyle.Success:ButtonStyle.Danger);
      (f<=5?rows[0]:rows[1]).addComponents(btn);
    }
    return i.update({ content:`Mode **${mode}** sélectionné. Choisis un floor :`, components: rows });
  }

  // (2) Choix du floor (F1–F7 / M1–M7)
  if (i.customId.startsWith("floor_")) {
    const [,mode,floor] = i.customId.split("_");
    const p = { owner:uid, mode, floor, size:5, vocal:false, time:null, members:[] };
    partyData.set(uid,p);

    const sizeRow = new ActionRowBuilder();
    [2,3,4,5].forEach(n =>
      sizeRow.addComponents(
        new ButtonBuilder().setCustomId(`size_${n}_${uid}`).setLabel(`${n} joueurs`).setStyle(ButtonStyle.Primary)
      )
    );
    return i.update({ content:`Floor **${mode} ${floor}** choisi ! Taille ? 👇`, components:[sizeRow] });
  }

  // (3) Choix de la taille (2–5 joueurs)
  if (i.customId.startsWith("size_")) {
    const [,size,owner] = i.customId.split("_");
    if (uid!==owner) return i.reply({ content:"❌ Seul le créateur peut choisir.", ephemeral:true });
    const p = partyData.get(owner); p.size = +size;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`vocal_yes_${owner}`).setLabel("🎧 Avec vocale").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`vocal_no_${owner}`).setLabel("🔇 Sans vocale").setStyle(ButtonStyle.Secondary)
    );
    return i.update({ content:"Souhaites-tu une **vocale** ?", components:[row] });
  }

  // (4) Choix de la vocale
  if (i.customId.startsWith("vocal_")) {
    const [,type,owner] = i.customId.split("_");
    const p = partyData.get(owner);
    if (uid!==owner) return i.reply({ content:"❌ Seul le créateur peut choisir.", ephemeral:true });
    p.vocal = type==="yes";

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`time_now_${owner}`).setLabel("🕒 Maintenant").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`time_30_${owner}`).setLabel("⏳ Dans 30 min").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`time_60_${owner}`).setLabel("🕐 Dans 1h").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`time_custom_${owner}`).setLabel("🗓️ Autre").setStyle(ButtonStyle.Secondary)
    );
    return i.update({ content:"🕒 À quelle heure ?", components:[row] });
  }

  // (5) Choix de l’heure (direct, +30min, +1h ou personnalisée)
  if (i.customId.startsWith("time_")) {
    const [,type,owner] = i.customId.split("_");
    const p = partyData.get(owner);
    if (!p) return;

    if (uid!==owner)
      return i.reply({ content:"❌ Seul le créateur peut définir.", ephemeral:true });

    // Cas : saisie manuelle
    if (type==="custom") {
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

    // Cas : options rapides
    const now = new Date();
    if (type==="30") now.setMinutes(now.getMinutes()+30);
    if (type==="60") now.setHours(now.getHours()+1);
    p.time = type==="now"
      ? "Maintenant"
      : now.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"});

    // Crée les boutons de classes et de gestion
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

    const embed = buildEmbed(p);
    const msg = await i.channel.send({ embeds:[embed], components:[classRow,manageRow] });
    p.messageId = msg.id;
    return i.update({ content:"✅ Party créée !", components:[] });
  }

  // (6) Cas de l’heure personnalisée (modal)
  if (i.type===InteractionType.ModalSubmit && i.customId.startsWith("modal_time_")) {
    const owner = i.customId.split("_")[2];
    const p = partyData.get(owner);
    if (!p) return i.reply({ content:"Erreur de party.", ephemeral:true });
    p.time = i.fields.getTextInputValue("time_input");
    return i.reply({ content:`✅ Heure définie sur ${p.time}`, ephemeral:true });
  }

  // (7) Choix de classe par les joueurs
  if (i.customId.startsWith("class_")) {
    const p = [...partyData.values()].find(x => x.messageId === i.message.id);
    if (!p) return;

    const chosen = i.customId.split("_")[1];
    const existing = p.members.find(m => m.id === uid);

    // Si le joueur a déjà choisi, il change de classe
    if (existing) { existing.class = chosen; return i.update({ embeds:[buildEmbed(p)] }); }

    if (p.members.length >= p.size)
      return i.reply({ content:"❌ Party complète !", ephemeral:true });

    // Récupère son niveau Catacombs avant d’ajouter
    const cata = await getCataLevelFromName(i.member);
    p.members.push({ id:uid, class:chosen, cata });
    await i.update({ embeds:[buildEmbed(p)] });

    // Si la party atteint la taille max → message final + fermeture
    if (p.members.length >= p.size) {
      const chan = await client.channels.fetch(i.channelId);
      const old = await chan.messages.fetch(p.messageId);
      await old.delete().catch(()=>{});

      const tags = p.members.map(m => `<@${m.id}>`).join(" ");
      await chan.send({
        content: `✅ **Party complète !**\n👥 ${tags}\n> <@${p.owner}> doit inviter tout le monde.`,
        embeds: [buildEmbed(p)]
      });
      partyData.delete(p.owner);
    }
  }

  // (8) Quitter la party
  if (i.customId === "leave_party") {
    const p = [...partyData.values()].find(x => x.messageId === i.message.id);
    if (!p) return;
    p.members = p.members.filter(m => m.id !== uid);
    return i.update({ embeds:[buildEmbed(p)] });
  }

  // (9) Supprimer la party (seul le créateur)
  if (i.customId === "delete_party") {
    const p = [...partyData.values()].find(x => x.messageId === i.message.id);
    if (!p) return;
    if (uid !== p.owner)
      return i.reply({ content:"❌ Seul le créateur peut supprimer.", ephemeral:true });
    await i.message.delete().catch(()=>{});
    partyData.delete(p.owner);
    return i.reply({ content:"🗑️ Party supprimée.", ephemeral:true });
  }
});

/* ==========================
   6. SERVEUR KEEP-ALIVE
   ========================== */
express()
  .get("/", (req, res) => res.send("Bot actif"))
  .listen(process.env.PORT || 3000, () => console.log("🌐 Keep-alive actif."));

client.login(process.env.TOKEN);
