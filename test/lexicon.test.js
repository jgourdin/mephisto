const { test } = require("node:test");
const assert = require("node:assert");
const L = require("../src/lexicon.js");
globalThis.WMC_INTEREST = require("../src/interest.js");

const HTML = `<html><body>
  Mots-clés associés :
  <a href="motscles.aspx?m=shonen">shonen</a>, <a href="motscles.aspx?m=otaku">otaku</a>,
  <a href="motscles.aspx?m=tome">tome</a>, <a href="motscles.aspx?m=Toriyama">Toriyama</a>,
  <a href="motscles.aspx?m=One%20Piece">One Piece</a>
  <a href="index.aspx">Accueil</a>
</body></html>`;

test("parseRimes extrait les mots motscles, ignore la nav", () => {
  const w = L.parseRimes(HTML);
  assert.ok(w.includes("shonen"));
  assert.ok(w.includes("Toriyama"));
  assert.ok(w.includes("One Piece"));
  assert.ok(!w.includes("Accueil")); // lien non-motscles ignoré
});

test("applyFilter: ≥4 pour mots rimessolides, ≥3 pour mots du nom, exclut removed", () => {
  const nameSet = new Set(["rap"]); // "rap" vient du nom -> autorisé à 3 lettres
  const words = ["rap", "ova", "shonen", "otaku"]; // ova = 3 lettres NON-nom -> rejeté
  const out = L.applyFilter(words, ["otaku"], nameSet);
  assert.ok(out.includes("rap"), "mot du nom de 3 lettres gardé");
  assert.ok(out.includes("shonen"), "mot >=4 gardé");
  assert.ok(!out.includes("ova"), "mot rimessolides de 3 lettres rejeté (Prudent >=4)");
  assert.ok(!out.includes("otaku"), "mot dans removed exclu");
});
