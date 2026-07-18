// Régression S13 : rejoue l'évaluation du banc avec le code de prod.
// Usage: node tools/regression-s13.mjs /chemin/vers/bench-cache.json
import { createRequire } from "module";
import fs from "fs";
const require = createRequire(import.meta.url);
const I = require("../src/interest.js");
const cachePath = process.argv[2];
if (!cachePath) { console.error("usage: node tools/regression-s13.mjs <bench-cache.json>"); process.exit(2); }
const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
const EVAL = [
  ["Mathilde de Flandre", ["histoire_fr"]], ["Joachim Murat", ["histoire_fr"]], ["Gaule", ["histoire_fr"]],
  ["Henri VI (roi d'Angleterre)", ["histoire_fr"]], ["3robi", ["rap"]], ["Drill (musique)", ["rap"]],
  ["Alan Braxe", ["techno"]], ["Tayc", ["chanson_fr"]], ["Gérald de Palmas", ["chanson_fr"]],
  ["Charles Pépin", ["philo"]], ["Ontologie (philosophie)", ["philo"]], ["Tejina Senpai", ["manga"]],
  ["Tokio Shima", ["manga"]], ["Sonic", ["jeu_video"]], ["Forza Horizon 2", ["jeu_video"]], ["Stunfest", ["jeu_video"]],
  ["Champigny-sur-Marne", ["val94"]], ["Île Fanac", ["val94"]], ["Nîmes", ["nimes_gard"]], ["Manade Saumade", ["nimes_gard"]],
  ["Mairie de Paris", ["paris"]], ["Quatre-Septembre (métro de Paris)", ["paris"]], ["Patrick Kanner", ["gauche"]],
  ["Gregor Gysi", ["gauche"]], ["Comités de défense de la révolution (Burkina Faso)", ["gauche"]],
  ["Stegobium paniceum", []], ["Fernando Muslera", []], ["Marc Márquez", []], ["Delta Goodrem", []],
  ["Électroculture", []], ["Élections municipales de 2020 à Toulouse", []], ["Lauren Weisberger", []],
  ["Qatar Sports Investments", []], ["James Burrows", []], ["Sassari", []],
];
const NAMES = { manga: "Manga & anime", jeu_video: "Jeu vidéo", histoire_fr: "Histoire de France", gauche: "Gauche & luttes", philo: "Philosophie", techno: "Techno & électro", rap: "Rap & hip-hop", chanson_fr: "Chanson française", val94: "Val-de-Marne (94)", paris: "Paris", nimes_gard: "Nîmes & Gard" };
const rootsByTag = Object.entries(NAMES).map(([id, name]) => ({ tagId: id, roots: cache.tagRoots[name] || [] }));
const parents = new Map(Object.entries(cache.catParents || {}));
let tp = 0, fp = 0, fn = 0;
for (const [title, expected] of EVAL) {
  const cats = cache.catsTop[title] || [];
  const pred = new Set(Object.keys(I.walkAncestry(cats, rootsByTag, parents, 3)));
  const exp = new Set(expected);
  for (const t of pred) exp.has(t) ? tp++ : fp++;
  for (const t of exp) if (!pred.has(t)) fn++;
}
const P = tp / (tp + fp), R = tp / (tp + fn), F1 = (2 * P * R) / (P + R);
console.log(`S13 prod d≤3 : P ${(100 * P).toFixed(0)}%  R ${(100 * R).toFixed(0)}%  F1 ${(100 * F1).toFixed(0)}%  (TP/FP/FN ${tp}/${fp}/${fn})`);
if (F1 < 0.75) { console.error("RÉGRESSION: F1 < 75% (banc: 78%)"); process.exit(1); }
console.log("OK — conforme au banc.");
