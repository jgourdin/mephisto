# 😈 Méphisto v0.5.0

Companion perso pour [WikiMasters](https://www.wiki-masters.com) : ouvre tes paquets, **snipe** les enchères et revend automatiquement, avec un dashboard sur la page du jeu. Dispo en **extension Chrome/Firefox** et en **app Android**.

## Nouveautés

- 🎯 **Sniper de fin de partie** — fini les mises précoces qui font monter le prix pour rien. Méphisto reste en embuscade et ne frappe que dans la dernière fenêtre (~12-15 s, juste au-dessus du seuil anti-snipe). Tu gagnes plus, et moins cher. Achats **SR et +** uniquement, toujours sous ta mise max.
- 🩹 **Fini l'« écran vide » de la marketplace** — usage de l'API bien plus économe (cache partagé, lectures ciblées) : on ne sature plus les requêtes du jeu.
- 🛡️ **Plafond de dépense fiable** — calculé sur ton solde réel (delta du jour). Il se met en pause tout seul quand trop de WikiBidous sont engagés, et reprend au remboursement.
- ⚙️ **Moteur en arrière-plan** — l'ouverture de paquets et la mise en vente tournent même onglet fermé (service worker). ⚠️ Le **snipe**, lui, demande l'onglet du jeu ouvert : viser la bonne seconde est impossible depuis une alarme d'arrière-plan.
- 💰 **Auto-sell (flip)** — reliste au hasard tes cartes **UR/SR** (jamais les Légendaires, ni les favoris ★) à un prix cible, durée 10 min.
- 🔒 **Sécurité** — dry-run impossible à désactiver sans pseudo, plafonds mise max + dépense/jour.

## Installer

- **Chrome / Arc / Brave / Edge** : télécharge `mephisto-extension.zip`, décompresse, `chrome://extensions` → Mode développeur → « Charger l'extension non empaquetée ».
- **Firefox** : `mephisto-firefox.zip` → `about:debugging` → « Charger un module temporaire » (ou signé via AMO pour du permanent).
- **Android** : `mephisto-v0.5.0.apk` → ouvrir sur le téléphone → autoriser la source.

Procédures détaillées dans le [README](https://github.com/jgourdin/mephisto#installation).

## Pour démarrer

Renseigne **ton pseudo** dans le panneau 😈, laisse **Dry-run** coché pour observer, puis décoche pour passer en réel. Le sniper tourne tant que l'onglet du jeu est ouvert.

## ⚠️ Avertissement

Projet **personnel, non officiel, à but d'apprentissage**. Non affilié à WikiMasters / WOKcraft. Automatiser son compte peut enfreindre les conditions du jeu (**risque de bannissement**). Utilisation à tes propres risques — voir [LICENSE](https://github.com/jgourdin/mephisto/blob/main/LICENSE).
