<p align="center">
  <img src="icons/icon128.png" alt="Méphisto" width="120" />
</p>

# Méphisto — pacte pour WikiMasters

> « Le diable est dans les enchères. »

Extension Chrome (MV3) perso pour [wiki-masters.com](https://www.wiki-masters.com) — projet d'apprentissage/fun : le démon des bonnes affaires qui automatise les corvées du jeu et lit l'avenir des prix, sans tricher en bataille. Ton compte, ton âme, ses conseils cyniques.

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

Il faut un navigateur **basé sur Chrome sur ordinateur** (Chrome, Arc, Brave, Edge). Pas de support mobile — voir plus bas.

1. Télécharge `mephisto-extension.zip` depuis la [dernière release](https://github.com/jgourdin/mephisto/releases/latest) et décompresse-le (garde le dossier `mephisto` à un endroit stable, pas dans un dossier que tu vides).
2. Ouvre `chrome://extensions`, active **« Mode développeur »** (en haut à droite).
3. Clique **« Charger l'extension non empaquetée »** → choisis le dossier `mephisto`.
4. Épingle l'icône (🧩 en haut à droite → épingle Méphisto).
5. Sur wiki-masters.com : le bouton **Méphisto en bas à droite** (le logo du démon) ouvre le dashboard ; le popup (icône dans la barre) contient les réglages.
6. Tout est **désactivé par défaut**. Coche « Automation active » pour démarrer ; laisse **« Dry-run »** coché tant que tu veux juste tester (simule sans agir).

> Installation en mode développeur : Chrome peut afficher un avertissement au démarrage (« désactiver les extensions en mode développeur ») — clique « Conserver ». Aucune donnée ne quitte ta machine ; automatiser son compte se fait à ton propre risque.

### Mobile ?

- **iOS** : non — tous les navigateurs y sont bridés sur WebKit, pas d'extensions Chrome.
- **Android** : possible via un navigateur Chromium qui accepte les extensions. Kiwi Browser (la référence historique) a fermé début 2025 ; alternatives maintenues en 2026 : **Quetta** ou **Lemur** (installent depuis le Chrome Web Store ou un zip). Chrome/Arc mobile ne supportent pas les extensions.
- **Ordinateur** : le cas nominal, pleinement supporté.

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
