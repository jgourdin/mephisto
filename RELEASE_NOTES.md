# 😈 Méphisto v0.8.0

Méphisto ne se fie plus aux pages-vues Wikipédia — il estime la **désirabilité réelle** d'une carte pour le public geek/FR de WikiMasters, et achète/vend en conséquence.

## Pourquoi cette version

En v0.7.0, la valeur d'une carte venait surtout de ses **pages-vues Wikipédia** — un mauvais proxy : une UR obscure à 26 000 vues (dopée par l'actu) valait « 557 » pour le modèle… mais se vendait **10 WB** en vrai, pendant qu'une icône française à 9 000 vues atteignait **600**. La v0.8.0 corrige ça à la racine.

## Nouveautés

- 🧠 **Valeur par désirabilité (sans IA)** — Méphisto note chaque carte (0-6) à partir de signaux **structurels** Wikipédia, tous déterministes :
  - **notoriété mondiale** (nombre de langues de la page)
  - **ancrage** (nombre de pages qui pointent vers elle — capte le culte français)
  - **intérêt durable** (stabilité des vues sur 12 mois — élimine les pics d'actu)
  - **catégorie geek** (jeu vidéo, manga, SF…) en bonus
  Résultat validé sur le marché réel : Zelda / Naruto / Lovecraft → **6/6**, un politique obscur → 3, une UR sans notoriété → 0.
- 🎯 **Achat plus fin** — ne surpaie plus les cartes obscures qui « semblaient » chères, et repère les vraies pépites sous-cotées. Toujours borné par le plafond dur par carte.
- 💰 **Vente à la valeur** — le prix de départ des UR/L monte avec la désirabilité (obscure → base modeste, désirable → base haute) : fini les UR qui valent des centaines bradées à ~10 WB. L'enchère découvre le premium au-dessus du plancher.
- 📊 **Panneau « Désirabilité »** — voir les cartes évaluées, leur score et leur valeur estimée directement dans le dashboard 😈.
- 🧾 **Apprentissage du marché** — Méphisto enregistre les prix de vente réels pour affiner sa valorisation dans le temps.

Sur la base de la v0.7.0 : épargne de la guilde, sniper de fin de partie, plafond de dépense, surveillance multi-cibles, test A/B vente, Firefox + Android.

## Installer

- **Chrome / Arc / Brave / Edge** : télécharge `mephisto-extension.zip`, décompresse, `chrome://extensions` → Mode développeur → « Charger l'extension non empaquetée ».
- **Firefox** : `mephisto-firefox.zip` → `about:debugging` → « Charger un module temporaire ».
- **Android** : `mephisto-v0.8.0.apk` → ouvrir sur le téléphone → autoriser la source.

Procédures détaillées dans le [README](https://github.com/jgourdin/mephisto#installation).

## Pour démarrer

Renseigne **ton pseudo** dans le panneau 😈, laisse **Dry-run** coché pour observer, puis décoche pour passer en réel. Tourne tant que l'onglet du jeu est ouvert. Le panneau « Désirabilité » se remplit au fil des cycles.

## ⚠️ Avertissement

Projet **personnel, non officiel, à but d'apprentissage**. Non affilié à WikiMasters / WOKcraft. Automatiser son compte peut enfreindre les conditions du jeu (**risque de bannissement**). Utilisation à tes propres risques — voir [LICENSE](https://github.com/jgourdin/mephisto/blob/main/LICENSE).
