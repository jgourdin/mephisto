# 😈 Méphisto v0.5.1

Patch de la v0.5.0 — l'auto-sell vend enfin.

## Amélioré

- 💰 **Prix de vente intelligent** — les mises en vente démarrent **juste au-dessus de ton prix d'achat** (≈ +15 %, jamais à perte) au lieu d'un prix fixe trop haut qui restait invendu. Une **base basse** déclenche la guerre d'enchères qui fait monter le prix ; une base haute reste ignorée (données marché : les enchères qui reçoivent des offres démarrent ~10 WB, celles qui meurent ~99). Base de repli abaissée à ~5 WB pour les cartes dont on ne connaît plus le coût.

Le reste de la v0.5.0 est inclus : sniper de fin de partie, plafond de dépense par solde, moteur en arrière-plan, achats **SR et +**, ventes **UR/SR** au hasard (jamais les Légendaires ni les favoris ★), Firefox + Android.

## Installer

- **Chrome / Arc / Brave / Edge** : télécharge `mephisto-extension.zip`, décompresse, `chrome://extensions` → Mode développeur → « Charger l'extension non empaquetée ».
- **Firefox** : `mephisto-firefox.zip` → `about:debugging` → « Charger un module temporaire » (ou signé via AMO pour du permanent).
- **Android** : `mephisto-v0.5.1.apk` → ouvrir sur le téléphone → autoriser la source.

Procédures détaillées dans le [README](https://github.com/jgourdin/mephisto#installation).

## ⚠️ Avertissement

Projet **personnel, non officiel, à but d'apprentissage**. Non affilié à WikiMasters / WOKcraft. Automatiser son compte peut enfreindre les conditions du jeu (**risque de bannissement**). Utilisation à tes propres risques — voir [LICENSE](https://github.com/jgourdin/mephisto/blob/main/LICENSE).
