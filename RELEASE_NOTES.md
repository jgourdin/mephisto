# 😈 Méphisto v0.9.3

Confort d'usage et distribution : aide contextuelle intégrée partout, et l'extension Firefox est désormais signée automatiquement (installation permanente + mises à jour auto).

## Changements

- 💬 **Aide contextuelle (tooltips)** : chaque réglage du dashboard et de la popup affiche une infobulle qui explique ce qu'il fait — plus besoin de deviner.
- 🦊 **Extension Firefox auto-signée (AMO)** : la CI signe l'extension via Mozilla (canal *unlisted*). Résultat : installation **permanente** (fini le module temporaire à recharger à chaque redémarrage) et **mises à jour automatiques** via `update_url`.
- 🛠️ **README & outils Android** : procédure d'installation clarifiée, génération du bundle companion (`build-companion.mjs`) fiabilisée.

Sur la base de la v0.9.2 : plafonds de mise calibrés sur le marché réel, Journal de l'IA, ciblage par étiquettes.

## Installer

- **Chrome / Arc / Brave / Edge** : `mephisto-extension.zip` → décompresse → `chrome://extensions` → Mode développeur → « Charger l'extension non empaquetée ».
- **Firefox** : `mephisto-firefox.xpi` (signé) → ouvre-le dans Firefox pour une installation permanente. À défaut, `mephisto-firefox.zip` → `about:debugging` → « Charger un module temporaire ».
- **Android** : `mephisto-v0.9.3.apk` → ouvrir sur le téléphone → autoriser la source.

Procédures détaillées dans le [README](https://github.com/jgourdin/mephisto#installation).
