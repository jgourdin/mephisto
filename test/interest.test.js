const { test } = require("node:test");
const assert = require("node:assert");
const I = require("../src/interest.js");

test("nameWords: composé + parenthèses -> phrase + tokens", () => {
  assert.deepStrictEqual(new Set(I.nameWords("Val-de-Marne (94)")), new Set(["val-de-marne", "marne"]));
  assert.deepStrictEqual(new Set(I.nameWords("Rap & hip-hop")), new Set(["rap", "hip-hop"]));
});

test("topicalCat: filtre meta et biographique", () => {
  assert.strictEqual(I.topicalCat("Duchesse de Normandie"), true);
  assert.strictEqual(I.topicalCat("Wikipédia:ébauche manga"), false);
  assert.strictEqual(I.topicalCat("Utilisateur Gauche de gauche"), false);
  assert.strictEqual(I.topicalCat("Naissance à Paris"), false);
  assert.strictEqual(I.topicalCat("Décès à Caen"), false);
  assert.strictEqual(I.topicalCat(""), false);
});

// Fixture: le cas Mathilde — Duchesse de Normandie remonte à Histoire de France en 3.
const PARENTS = new Map([
  ["Duchesse de Normandie", ["Duché de Normandie"]],
  ["Duché de Normandie", ["Histoire de France par territoire"]],
  ["Histoire de France par territoire", ["Histoire de France"]],
  ["Maison de Flandre", ["Noblesse flamande"]],
  ["Rappeur néerlandais", ["Rappeur par nationalité"]],
  ["Rappeur par nationalité", ["Rap"]],
  ["Cycle A", ["Cycle B"]],
  ["Cycle B", ["Cycle A"]],
]);
const ROOTS = [
  { tagId: "histoire_fr", roots: ["Histoire de France"] },
  { tagId: "rap", roots: ["Rap"] },
];

test("walkAncestry: Mathilde -> histoire_fr à profondeur 3 (pas à 2)", () => {
  const cats = ["Duchesse de Normandie", "Maison de Flandre", "Naissance à Bruges"];
  assert.deepStrictEqual(I.walkAncestry(cats, ROOTS, PARENTS, 4), { histoire_fr: 3 });
  assert.deepStrictEqual(I.walkAncestry(cats, ROOTS, PARENTS, 2), {});
});

test("walkAncestry: profondeur 0 quand une catégorie de départ EST une racine", () => {
  assert.deepStrictEqual(I.walkAncestry(["Rap"], ROOTS, PARENTS, 3), { rap: 0 });
});

test("walkAncestry: rappeur -> rap à d2 ; cycles sans boucle infinie", () => {
  assert.deepStrictEqual(I.walkAncestry(["Rappeur néerlandais", "Cycle A"], ROOTS, PARENTS, 5), { rap: 2 });
});

test("walkAncestry: les catégories bio/meta de départ sont ignorées", () => {
  assert.deepStrictEqual(I.walkAncestry(["Naissance à Bruges", "Wikipédia:ébauche"], ROOTS, PARENTS, 5), {});
});

test("missingParents: liste les catégories sans parents cachés", () => {
  const partial = new Map([["Duchesse de Normandie", ["Duché de Normandie"]]]);
  const missing = I.missingParents(["Duchesse de Normandie", "Maison de Flandre"], partial, 3);
  assert.ok(missing.includes("Maison de Flandre"));
  assert.ok(missing.includes("Duché de Normandie"));
  assert.ok(!missing.includes("Duchesse de Normandie"));
});

test("titleTags: fast-path titre en bord de mot", () => {
  const tags = [{ tagId: "h", name: "Histoire de France" }, { tagId: "v", name: "Val-de-Marne (94)" }];
  assert.deepStrictEqual(I.titleTags({ wikipedia_title: "Histoire de France au XIXe" }, tags), ["h"]);
  assert.deepStrictEqual(I.titleTags({ wikipedia_title: "Champigny-sur-Marne" }, tags), ["v"]); // via "marne"
  assert.deepStrictEqual(I.titleTags({ wikipedia_title: "Stegobium paniceum" }, tags), []);
});
