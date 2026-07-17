const { test } = require("node:test");
const assert = require("node:assert");
const L = require("../src/lexicon.js");

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
