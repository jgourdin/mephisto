// L'aide par champ (WMC_HELP) est saisie à la main dans config.js alors que la
// liste des champs vit dans dashboard.js et popup.html. Rien ne relie les deux à
// l'exécution : une clé mal orthographiée ou un champ ajouté sans aide passerait
// inaperçu (le badge ⓘ ne s'afficherait simplement pas). D'où ces gardes.

const test = require("node:test");
const assert = require("node:assert");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const { WMC_DEFAULTS, WMC_HELP } = require("../src/config.js");
const src = (f) => readFileSync(join(__dirname, "..", "src", f), "utf8");

test("toute clé d'aide correspond à un réglage existant", () => {
  for (const key of Object.keys(WMC_HELP)) {
    assert.ok(key in WMC_DEFAULTS, `WMC_HELP.${key} ne correspond à aucune clé de WMC_DEFAULTS`);
  }
});

test("toute aide est une phrase non vide", () => {
  for (const [key, text] of Object.entries(WMC_HELP)) {
    assert.ok(typeof text === "string" && text.trim().length > 20, `WMC_HELP.${key} est vide ou trop court`);
  }
});

test("tout champ du dashboard a une aide", () => {
  // dashboard.js est une IIFE non require-able : on extrait les clés de CONTROLS.
  const controls = [...src("dashboard.js").matchAll(/\{ k: "(\w+)"/g)].map((m) => m[1]);
  assert.ok(controls.length > 20, "extraction de CONTROLS cassée");
  for (const key of controls) {
    assert.ok(WMC_HELP[key], `le champ dashboard "${key}" n'a pas d'entrée dans WMC_HELP`);
  }
});

test("tout champ du popup a une aide", () => {
  const ids = [...src("popup.html").matchAll(/<input[^>]*id="(\w+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 9, "extraction des inputs du popup cassée");
  for (const key of ids) {
    assert.ok(WMC_HELP[key], `le champ popup "${key}" n'a pas d'entrée dans WMC_HELP`);
  }
});
