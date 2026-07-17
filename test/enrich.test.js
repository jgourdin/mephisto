const { test } = require("node:test");
const assert = require("node:assert");
const E = require("../src/enrich.js");

test("cleanCategoryTitles retire 'Catégorie:'/'Category:' et les vides", () => {
  assert.deepStrictEqual(
    E.cleanCategoryTitles([{ title: "Catégorie:Maison de Flandre" }, { title: "Category:Nobility" }, { title: "Duchesse de Normandie" }, { title: "" }, {}]),
    ["Maison de Flandre", "Nobility", "Duchesse de Normandie"]
  );
});
