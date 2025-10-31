# ⚔️ Hypixel Skyblock — Dungeon Party Finder Bot

> Un bot Discord permettant d’organiser facilement des groupes pour les **Dungeons Hypixel Skyblock**, avec affichage automatique du **niveau Catacombs** via l’API Hypixel.

---

## 🇫🇷 Description

Ce bot Discord simplifie la **recherche de party** dans les donjons d’Hypixel Skyblock.  
Il permet de créer un **Party Finder interactif** directement sur Discord :

- Sélection du **mode** (Normal / Master)
- Choix du **floor** (F1–F7 / M1–M7)
- Définition de la **taille**, de l’**horaire**, et de la **vocale**
- Sélection d’une **classe** (Berserker, Tank, Healer, Archer, Mage)
- Récupération automatique du **niveau Catacombs (Cata)** via l’API Hypixel
- Annonce automatique quand la party est complète

Le bot ne stocke **aucune donnée**.  
Il effectue uniquement des **requêtes en lecture seule** aux APIs Hypixel et Mojang.

---

## ⚙️ Installation

### 1️⃣ Prérequis
- Node.js 20+
- Un bot Discord fonctionnel
- Une clé API Hypixel (obtenue via [developer.hypixel.net](https://developer.hypixel.net/dashboard/apps))
- Un hébergeur (Render, Railway, VPS…)

### 2️⃣ Installation des dépendances
```bash
npm install discord.js node-fetch express dotenv

