# 😈 Méphisto v0.9.1

Deux ajouts qui te redonnent la main sur ce que fait Méphisto : des **plafonds de mise séparés** (pour ne pas payer une carte de tes thèmes comme une carte lambda), et un **journal visuel** de tout ce que l'IA a fait.

## Nouveautés

- 🎯 **Plafonds de mise différenciés** — fini le plafond unique :
  - **Mise max « centres d'intérêt »** (100 WB par défaut) pour les cartes de tes étiquettes, **toutes raretés confondues** — une commune ou une carte rare qui te tient à cœur devient sniperable, plus seulement les SR+.
  - **Mise max par rareté** pour les cartes normales : **L 80 · UR 50 · SR 15 WB** (réglables), avec un plafond « par défaut » en filet de sécurité. Mettre un plafond à 0 = ne jamais miser sur cette catégorie.
  - Le bonus on-theme (+20 sur la valeur estimée) reste, borné par le plafond intérêt ; `dailySpendCap` reste le frein global.
- 🧾 **Journal de l'IA** — une nouvelle section du dashboard liste les **25 dernières actions** de Méphisto, horodatées : mises 🎯 (montant + badge « centre d'intérêt »), ventes 💰 (réelles et dry-run), paquets ouverts 📦, étiquetages 🏷️, **protections anti-vente 🛡️** et repérages marché 👀. Tu vois enfin, d'un coup d'œil, ce que le démon a trafiqué.
- 🎛️ Les cinq plafonds sont réglables en direct dans le panneau.

## Correctifs & coulisses

- Base locale migrée en v7 (nouveau journal `action_log`, borné et auto-purgé).
- Le repérage marché et l'enrichissement couvrent désormais toutes les raretés quand le ciblage par thèmes est actif (sinon une carte on-theme de faible rareté passait sous le radar).
- Vérifié en conditions réelles avant publication : plafonds appliqués carte par carte, migration de base, cycle dry-run, panneau rendu.

Sur la base de la v0.9.0 : ciblage par étiquettes via l'ascendance du graphe Wikipédia, racines éditables, auto-étiquetage, protection anti-vente.

## Installer

- **Chrome / Arc / Brave / Edge** : `mephisto-extension.zip` → décompresse → `chrome://extensions` → Mode développeur → « Charger l'extension non empaquetée ». (Mise à jour : recharge simplement l'extension.)
- **Firefox** : `mephisto-firefox.zip` → `about:debugging` → « Charger un module temporaire ».
- **Android** : `mephisto-v0.9.1.apk` → ouvrir sur le téléphone → autoriser la source.

Procédures détaillées dans le [README](https://github.com/jgourdin/mephisto#installation).
