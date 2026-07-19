// Assembles the Firefox build from the SAME source as Chrome. Single source of
// truth: root manifest.json + src/ + icons/. We only transform where Firefox
// MV3 differs from Chrome MV3:
//   - background: Chrome uses `service_worker`; Firefox uses an event page
//     (`scripts`). We list the deps in load order so they're defined before
//     background.js runs (its importScripts guard is skipped on Firefox).
//   - browser_specific_settings.gecko.id is required by Firefox/AMO.
//   - gecko.data_collection_permissions is required by AMO since 2025 — every
//     add-on must declare what it collects. Méphisto ne transmet rien à un
//     tiers (tout reste en IndexedDB local / chrome.storage) => "none".
//   - gecko.update_url : on est en auto-distribution (unlisted), donc Firefox
//     n'a aucune source de mise à jour par défaut. Il faut lui donner le JSON
//     qui annonce la dernière version — voir updates.json généré plus bas.
//
// Output: dist-firefox/ (ready to zip into an .xpi) + updates.json à la racine
// (attaché à la release, PAS dans le zip). Run: node tools/build-firefox.mjs

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const dist = join(repo, "dist-firefox");

// Source unique : l'id gecko sert au manifeste ET à updates.json. Ne jamais le
// changer — c'est la clé d'identité de l'add-on côté Firefox (le modifier
// casserait la chaîne de mise à jour et les réglages des installs existantes).
const GECKO_ID = "mephisto@jgourdin";
const REPO_URL = "https://github.com/jgourdin/mephisto";

const manifest = JSON.parse(readFileSync(join(repo, "manifest.json"), "utf8"));

// Chrome service worker -> Firefox event-page background (deps first).
manifest.background = { scripts: ["src/config.js", "src/api.js", "src/value.js", "src/engine.js", "src/background.js"] };
manifest.browser_specific_settings = {
  gecko: {
    id: GECKO_ID,
    // 140 = première version qui gère nativement data_collection_permissions
    // (en dessous, la clé est ignorée et le prompt d'installation ne montre
    // pas la déclaration « aucune donnée collectée »).
    strict_min_version: "140.0",
    update_url: REPO_URL + "/releases/latest/download/updates.json",
    data_collection_permissions: { required: ["none"] },
  },
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
cpSync(join(repo, "src"), join(dist, "src"), { recursive: true });
cpSync(join(repo, "icons"), join(dist, "icons"), { recursive: true });

// Manifeste de mise à jour Firefox. Écrit à la RACINE du repo, pas dans dist-
// firefox/ : il ne doit pas finir dans l'.xpi. Le tag vient de la CI ; en local
// on retombe sur la version du manifeste.
// NB : update_link pointe vers un .xpi qui n'existe pas encore au moment du
// build — l'.xpi signé n'arrive qu'après le passage sur AMO, et doit être
// uploadé sur la même release sous ce nom exact.
const tag = process.env.GITHUB_REF_NAME || "v" + manifest.version;
const updates = {
  addons: {
    [GECKO_ID]: {
      updates: [
        {
          version: manifest.version,
          update_link: REPO_URL + "/releases/download/" + tag + "/mephisto-firefox.xpi",
        },
      ],
    },
  },
};
writeFileSync(join(repo, "updates.json"), JSON.stringify(updates, null, 2) + "\n");

console.log("Firefox package assembled in " + dist + " — zip its contents into mephisto-firefox.xpi/zip");
console.log("updates.json written for " + tag + " — attach it to the GitHub release");
