const { test } = require("node:test");
const assert = require("node:assert");
globalThis.WMC_INTEREST = require("../src/interest.js");
const A = require("../src/ancestry.js");

test("parsePagesCategories: nettoie les préfixes et filtre meta/bio", () => {
  const json = { query: { pages: {
    "1": { title: "Catégorie:Duché de Normandie", categories: [
      { title: "Catégorie:Histoire de la Normandie" },
      { title: "Catégorie:Wikipédia:ébauche Normandie" },
      { title: "Catégorie:Naissance en Normandie" },
    ] },
    "2": { title: "Catégorie:Rap", categories: [{ title: "Catégorie:Hip-hop" }] },
    "3": { title: "Catégorie:Sans parents" },
  } } };
  assert.deepStrictEqual(A.parsePagesCategories(json), {
    "Duché de Normandie": ["Histoire de la Normandie"],
    "Rap": ["Hip-hop"],
    "Sans parents": [],
  });
});

test("effectiveRoots: (résolues ∪ ajoutées) \\ retirées", () => {
  assert.deepStrictEqual(
    A.effectiveRoots({ resolved: ["Techno", "Electro"], added: ["Musique électronique"], removed: ["Electro"] }),
    ["Techno", "Musique électronique"]
  );
});
