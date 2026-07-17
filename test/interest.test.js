const { test } = require("node:test");
const assert = require("node:assert");
const I = require("../src/interest.js");

const card = (t, c) => ({ wikipedia_title: t, category: c });
const compiled = (tags) => I.compileVocab(tags);

test("nameWords: composé + parenthèses -> phrase + tokens (seuil 3)", () => {
  assert.deepStrictEqual(new Set(I.nameWords("Val-de-Marne (94)")), new Set(["val-de-marne", "marne"]));
  assert.deepStrictEqual(new Set(I.nameWords("Rap & hip-hop")), new Set(["rap", "hip-hop"]));
  assert.deepStrictEqual(new Set(I.nameWords("Nîmes & Gard")), new Set(["nimes", "gard"]));
});

test("matchable: seuil de longueur + stoplist", () => {
  assert.strictEqual(I.matchable("shonen"), true);
  assert.strictEqual(I.matchable("toi"), false); // < 4
  assert.strictEqual(I.matchable("tome"), false); // stopword
  assert.strictEqual(I.matchable("rap", 3), true); // seuil 3 pour les noms
});

test("classify: catégories Wikipédia -> tag (Mathilde via 'normandie')", () => {
  const v = compiled([{ tagId: "H", words: ["normandie", "capetien", "gaulois"] }]);
  const c = card("Mathilde de Flandre", "épouse de Guillaume le Conquérant");
  const m = { categories: ["Duchesse de Normandie", "Maison de Flandre"] };
  assert.deepStrictEqual(I.classify(c, m, v), ["H"]);
});

test("classify: matche le titre (One Piece via vocab manga)", () => {
  const v = compiled([{ tagId: "M", words: ["shonen", "one piece", "otaku"] }]);
  assert.deepStrictEqual(I.classify(card("One Piece", "série"), null, v), ["M"]);
});

test("classify: bord de mot -> pas de faux positif de sous-chaîne", () => {
  const v = compiled([{ tagId: "G", words: ["ales"] }]); // ex. mot parasite
  assert.deepStrictEqual(I.classify(card("Élections municipales", "élections"), { categories: ["Élection municipale"] }, v), []);
});

test("classify: rien -> []", () => {
  const v = compiled([{ tagId: "M", words: ["shonen", "manga"] }]);
  assert.deepStrictEqual(I.classify(card("Stegobium paniceum", "insecte"), { categories: ["Anobiidae"] }, v), []);
});
