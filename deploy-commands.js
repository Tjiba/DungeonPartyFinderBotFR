import { REST, Routes, SlashCommandBuilder } from "discord.js";
import dotenv from "dotenv";
dotenv.config();

export default async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("pf")
      .setDescription("Créer une recherche de party pour un donjon"),
  ].map((command) => command.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  try {
    console.log("📦 Enregistrement de la commande /pf...");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log("✅ Commande /pf enregistrée avec succès !");
  } catch (error) {
    console.error("❌ Erreur :", error);
  }
}
