// Assembles the Firefox build from the SAME source as Chrome. Single source of
// truth: root manifest.json + src/ + icons/. We only transform where Firefox
// MV3 differs from Chrome MV3:
//   - background: Chrome uses `service_worker`; Firefox uses an event page
//     (`scripts`). We list the deps in load order so they're defined before
//     background.js runs (its importScripts guard is skipped on Firefox).
//   - browser_specific_settings.gecko.id is required by Firefox/AMO.
//
// Output: dist-firefox/ (ready to zip into an .xpi). Run: node tools/build-firefox.mjs

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const dist = join(repo, "dist-firefox");

const manifest = JSON.parse(readFileSync(join(repo, "manifest.json"), "utf8"));

// Chrome service worker -> Firefox event-page background (deps first).
manifest.background = { scripts: ["src/config.js", "src/api.js", "src/value.js", "src/engine.js", "src/background.js"] };
manifest.browser_specific_settings = {
  gecko: { id: "mephisto@jgourdin", strict_min_version: "128.0" },
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
cpSync(join(repo, "src"), join(dist, "src"), { recursive: true });
cpSync(join(repo, "icons"), join(dist, "icons"), { recursive: true });

console.log("Firefox package assembled in " + dist + " — zip its contents into mephisto-firefox.xpi/zip");
