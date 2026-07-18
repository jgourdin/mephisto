# 😈 Méphisto v0.9.0

Méphisto connaît maintenant **tes goûts**. Il lit tes étiquettes WikiMasters, comprend ce qu'elles veulent dire grâce au graphe des catégories Wikipédia, et cible les cartes qui te ressemblent — au marché comme dans ta collection.

## Pourquoi cette version

Tu étiquettes tes cartes (« Histoire de France », « Rap & hip-hop », « Val-de-Marne »…) mais rien ne les exploitait, et taguer 1 300 cartes à la main est un enfer. Le premier prototype comparait des mots — précision mesurée : **27%**, inutilisable. La v0.9.0 change de méthode : au lieu de comparer des mots, Méphisto vérifie si une catégorie de la carte **descend** de la catégorie racine de ton étiquette dans le graphe Wikipédia. « Duchesse de Normandie » descend d'« Histoire de France » — aucun mot ne le dit, le graphe le sait. Résultat mesuré sur un banc de 35 cartes réelles : **précision ×3 (86%)**, validé en conditions réelles avant release.

## Nouveautés

- 🏷️ **Ciblage par étiquettes (100% dynamique)** — Méphisto lit **tes** étiquettes (celles de chaque utilisateur, rien en dur) et résout leur sens via les catégories Wikipédia. Quatre comportements, tous opt-in :
  - **Repérage marché** : notification quand une enchère porte sur une carte à ton goût.
  - **Auto-bid prioritaire** : les cartes on-theme passent en tête du sniper (toujours bornées par tes plafonds).
  - **Auto-étiquetage** : tes cartes reçoivent automatiquement les bonnes étiquettes (dry-run d'abord, réversible).
  - **Protection anti-vente** : une carte qui te ressemble n'est jamais auto-vendue — et dans le doute (graphe pas encore chargé), Méphisto **ne vend pas**.
- 🕸️ **Classifieur par ascendance de graphe** — déterministe, sans IA, sans mots-clés codés en dur. Deux profondeurs réglables : précision pour l'étiquetage (d3), rappel pour le marché (d4).
- 🌱 **Racines éditables** — le dashboard montre comment chaque étiquette a été comprise (ses catégories racines) ; clique pour en retirer, ajoute-en une si Méphisto a mal deviné (ex. ajouter « Musique électronique » à ton étiquette Techno).
- 🧮 **Respectueux des API** — graphe des parents en cache local (IndexedDB), remplissage budgété par cycle, lots de 50 catégories par appel. La couverture grandit cycle après cycle.
- 🧪 **Qualité** — 14 tests unitaires, un banc de régression rejouable (`tools/regression-s13.mjs`), CI obligatoire sur les PR, et vérification en conditions réelles (session, migration de base, cycle dry-run) avant cette release.
- ✨ Peaufinage : fini le double « 😈😈 » dans les notifications in-page.

Sur la base de la v0.8.0 : valeur par désirabilité, sniper de fin de partie, plafonds de dépense, auto-sell planchers dynamiques, test A/B vente, Firefox + Android.

## Installer

- **Chrome / Arc / Brave / Edge** : télécharge `mephisto-extension.zip`, décompresse, `chrome://extensions` → Mode développeur → « Charger l'extension non empaquetée ». (Mise à jour : recharge simplement l'extension.)
- **Firefox** : `mephisto-firefox.zip` → `about:debugging` → « Charger un module temporaire ».
- **Android** : `mephisto-v0.9.0.apk` → ouvrir sur le téléphone → autoriser la source.

Procédures détaillées dans le [README](https://github.com/jgourdin/mephisto#installation).
