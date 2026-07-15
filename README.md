<p align="center">
  <img src="icons/icon128.png" alt="Méphisto" width="120" />
</p>

# Méphisto — pacte pour WikiMasters

> « Le diable est dans les enchères. »

Extension Chrome (MV3) perso pour [wiki-masters.com](https://www.wiki-masters.com) — projet d'apprentissage/fun : le démon des bonnes affaires qui automatise les corvées du jeu et lit l'avenir des prix, sans tricher en bataille. Ton compte, ton âme, ses conseils cyniques.

## Sommaire

- [Avertissement](#avertissement)
- [Architecture](#architecture)
- [Features](#features)
- [Endpoints appris automatiquement](#endpoints-appris-automatiquement)
- [Garde-fous](#garde-fous)
- [Installation (extension, ordinateur)](#installation)
- [App Android (APK)](#app-android)
- [Structure du projet](#structure)
- [Notes](#notes)

## Avertissement

⚠️ Projet **personnel, non officiel et à but d'apprentissage** uniquement. Méphisto n'est **ni affilié, ni approuvé, ni soutenu** par WikiMasters / WOKcraft ni par aucun de ses ayants droit ; « WikiMasters » et les marques associées appartiennent à leurs propriétaires respectifs et ne sont cités que pour décrire la compatibilité.

Automatiser un compte peut enfreindre les conditions d'utilisation du jeu et **entraîner la suspension ou le bannissement du compte**. Utilisez ce logiciel **à vos propres risques** : vous êtes seul responsable du respect des CGU du jeu et des lois applicables. Le logiciel est fourni « **EN L'ÉTAT** », sans aucune garantie ni responsabilité de l'auteur pour tout dommage (voir [LICENSE](LICENSE)). Aucune donnée n'est collectée ni transmise à un tiers : tout reste local à ton navigateur/appareil.

## Architecture

Deux briques :

- **Couche données/conseil** (aucun risque) : logge passivement ce qu'on voit (prix d'enchères, tirages, ledger WB) dans un IndexedDB local et en tire des décisions — médianes de prix, doublons, deck de bataille, matches wishlist. Reconstruit gratuitement la « Vue du marché » réservée au PRO.
- **Automatisation d'actions** (opt-in, garde-fous) : auto-open paquets, auto-bid marché, auto-don guilde.

## Features

| Feature | Type | Description |
|---|---|---|
| Pack timer | données | Badge stock + notif avant saturation (régén stoppée à 10/10), alarme même onglet fermé. |
| Log des tirages | données | Diff `owned-card-ids` → enregistre chaque carte tirée (drop-rates). |
| Historique de prix | données | Logge chaque enchère vue (`/api/marketplace`) → médiane par rareté. |
| Dashboard overlay | données | Panneau injecté : solde + gagné/jour (ledger), médianes, doublons, deck bataille, meilleurs attaquants, matches wishlist. |
| Deck de bataille | conseil | 3 cartes max PV (Σ DEF) parmi ta collection. |
| Ranking d'attaque | conseil | Cartes classées par `ATK × obscurité` (obscurité ~ 1/pageviews) — l'adversaire rate le quiz = dégâts. |
| Matcher wishlist guilde | conseil | Croise la wishlist (`can_donate`) → « offre X à Y : +N pts ». |
| Auto-open paquets | action ✅ testé live | Ouvre les paquets via `POST /api/packs/open` (pas le DOM : le carrousel de révélation n'accepte que des events trusted). Draine jusqu'au seuil, reload pour resync. |
| Auto-bid marché | action ✅ testé live | Mise sur la meilleure affaire sous ton plafond `maxBidWb` (rareté cible). Escrow immédiat, remboursé si surenchéri — vérifié en réel. |
| Auto-don guilde | action | Offre le meilleur match 1×/jour (endpoint appris par le sniffer à ton 1er don manuel). |

**Exclu volontairement** : lookup automatique des réponses de quiz en bataille (triche contre de vrais joueurs).

## Endpoints appris automatiquement

Les endpoints POST non vérifiés (mise en vente, don guilde, ouverture de paquet) sont **appris par un sniffer réseau** (`src/net-sniffer.js`, monde MAIN) la première fois que tu fais l'action *à la main* : il observe la route + le payload et les stocke. L'automatisation reste inactive tant que l'endpoint n'a pas été vu une fois — jamais de devinette.

## Garde-fous

- Tout **off par défaut** ; master switch « Automation active » + **mode dry-run** (simule mise/don sans exécuter) activé par défaut.
- Aucune requête en background : DOM + API same-origin uniquement depuis les onglets ouverts, avec ta session.
- Cadence humaine : scan 45 s, jitter 1,5–6 s, 1 mise / 90 s, plancher anti-snipe 15 s (une mise <10 s prolonge l'enchère de 60 s), 1 don / jour.
- Plafonds : mise max par enchère + dépense WB/jour (UTC, WB engagés = conservateur).
- Risque assumé : automatiser son compte peut valoir un ban.

## Installation

Extension pour **navigateur de bureau**, en deux variantes : **Chrome** (et dérivés Arc / Brave / Edge) et **Firefox**. Pour mobile, voir [App Android](#app-android).

### Chrome / Arc / Brave / Edge

1. Télécharge `mephisto-extension.zip` depuis la [dernière release](https://github.com/jgourdin/mephisto/releases/latest) et décompresse-le (garde le dossier à un endroit stable, pas dans un dossier que tu vides).
2. Ouvre `chrome://extensions`, active **« Mode développeur »** (en haut à droite).
3. Clique **« Charger l'extension non empaquetée »** → choisis le dossier décompressé.
4. Épingle l'icône (🧩 en haut à droite → épingle Méphisto).

> Chrome peut afficher un avertissement au démarrage (« désactiver les extensions en mode développeur ») — clique « Conserver ».

### Firefox

- **Tester tout de suite** : va sur `about:debugging#/runtime/this-firefox` → **« Charger un module complémentaire temporaire »** → sélectionne `mephisto-firefox.zip` (ou son `manifest.json`). Valable jusqu'au redémarrage de Firefox.
- **Installation permanente / pour tes amis** : Firefox exige une **signature Mozilla**. Soumets `mephisto-firefox.zip` sur [addons.mozilla.org (Developer Hub)](https://addons.mozilla.org/developers/) en **auto-distribution (« On your own » / unlisted)** → Mozilla signe → tu récupères un `.xpi` signé installable définitivement (gratuit, pas de listing public obligatoire).

### Utilisation (Chrome & Firefox)

Sur wiki-masters.com : le bouton **Méphisto en bas à droite** (le logo du démon) ouvre le dashboard ; le popup (icône dans la barre) contient les réglages. Tout est **désactivé par défaut** — coche « Automation active » pour démarrer, et laisse **« Dry-run »** coché tant que tu veux juste tester (simule sans agir). Aucune donnée ne quitte ta machine.

### Mobile ?

- **Android** : une **app dédiée** (APK) est fournie — voir ci-dessous. Alternative sans app : un navigateur Chromium qui accepte les extensions (**Quetta** ou **Lemur** ; Kiwi Browser a fermé début 2025). Chrome/Arc mobile ne supportent pas les extensions.
- **iOS** : non — tous les navigateurs y sont bridés sur WebKit, ni extensions ni app WebView réaliste.

## App Android

_Alternative à l'extension, pour jouer sur Android._ Une app qui charge le jeu dans une WebView et **injecte le même code que l'extension** (`android/tools/build-companion.mjs` regénère le bundle depuis `src/` — logique single-source). La session vit dans l'app → l'accès API reste identique, auto-open/auto-bid fonctionnent. Pas de service d'accessibilité, pas de navigateur tiers.

### Installer l'APK sur Android

1. Depuis ton téléphone, ouvre la [dernière release](https://github.com/jgourdin/mephisto/releases/latest) et télécharge le fichier **`mephisto-vX.Y.Z.apk`**.
2. Ouvre le fichier téléchargé (via la notification ou l'appli **Fichiers** → Téléchargements).
3. Android affiche « Pour votre sécurité… installation bloquée » → appuie sur **Paramètres** et **autorise « cette source »** (l'appli depuis laquelle tu ouvres l'APK, ex. Chrome ou Fichiers).
4. Reviens en arrière et appuie sur **Installer**. Google Play Protect peut avertir (« appli inconnue ») → **Installer quand même**.
5. Ouvre **Méphisto**, autorise les **notifications** au 1er lancement.
6. **Connecte-toi** avec ton **email + mot de passe** WikiMasters (voir note login ci-dessous).
7. Sur le jeu, le bouton **Méphisto en bas à droite** (logo du démon) ouvre le dashboard et ses réglages. Tout est **désactivé par défaut** ; laisse **« Dry-run »** coché pour tester sans agir.

> **Login** : email + mot de passe uniquement. Le bouton « Se connecter avec Google » est **bloqué par Google dans les WebView** — utilise l'email/mot de passe.
> **Fonctionnement** : l'app automatise **quand elle est ouverte au premier plan** (Android gèle les apps en arrière-plan). Ce n'est pas un farmer écran éteint.

### Construire l'APK

- **Automatique (CI)** : pousse un tag `v*` → GitHub Actions (`.github/workflows/android.yml`) régénère le bundle, compile l'APK et l'**attache à la release** (avec le zip de l'extension).
- **Local** : `node android/tools/build-companion.mjs` puis `cd android && ./gradlew assembleDebug` (JDK 17 + SDK Android requis). APK dans `android/app/build/outputs/apk/debug/`. Le projet s'ouvre aussi dans Android Studio.

## Structure

```
manifest.json         # MV3 ; sniffer en monde MAIN, reste en monde isolé
src/net-sniffer.js    # (MAIN) apprend les endpoints POST par observation
src/relay.js          # pont MAIN → isolé, persiste les endpoints appris
src/config.js         # défauts + garde-fous
src/db.js             # IndexedDB : price_obs, pulls, wb_ledger, endpoints
src/api.js            # wrappers API same-origin (contrats vérifiés)
src/analysis.js       # fonctions pures : deck, attaquants, doublons, wishlist
src/pulls.js          # /pulls : stock, timer, auto-open, log tirages
src/marketplace.js    # /marketplace : historique prix, deal scorer, auto-bid
src/guild.js          # wishlist : notif + auto-don
src/dashboard.js      # overlay injecté (bouton flottant + panneau)
src/background.js      # service worker : badge, notifs, alarmes
src/popup.html|js     # réglages
docs/recon.md         # reverse-engineering (DOM + API + règles)
```

## Notes

Toute la connaissance du jeu (règles, endpoints, structures JSON) est dans `docs/recon.md` et dans la mémoire Claude `reference_wikimasters_game.md`. Endpoints de lecture tous vérifiés en live le 15/07/2026 ; sélecteurs DOM heuristiques (pas d'ids stables) à re-vérifier si l'UI change.
