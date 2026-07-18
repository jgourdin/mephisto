# Classifieur par ascendance de graphe (S13) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le matching de mots (rimessolides) par l'ascendance de graphe Wikipédia (banc : F1 78 vs 41), avec fast-path titre, racines éditables et deux profondeurs configurables.

**Architecture:** `WMC_INTEREST` (pur) gagne `walkAncestry`/`missingParents`/`titleTags` et perd `compileVocab`/`classify`. Nouveau `WMC_ANCESTRY` (I/O) : résolution des racines par étiquette + parents de catégories par lots (`origin=*`, pas de service worker), caches DB `interest_roots`/`cat_parents` (v6). `engine.js` : état interest (racines+parents, cache 10 min), backfill budgété, profondeur 3 pour l'auto-tag / 4 pour marché+protection. `dashboard.js` : racines éditables + comptes. Suppression complète de la voie rimessolides.

**Tech Stack:** JS navigateur (extension MV3, IIFE globaux `WMC_*`), tests `node --test test/*.test.js` (Node 22). API MediaWiki avec `origin=*` (CORS anonyme, déjà utilisé par enrich.js).

## Global Constraints

- **Zéro thème/vocabulaire en dur** ; racines résolues dynamiquement depuis le nom de l'étiquette, éditables par l'utilisateur.
- **Off par défaut** : `interestWatch`/`interestAutoBid`/`interestAutoTag` = false ; `interestProtectSell` = true, **fail-closed** (si les modules interest sont indisponibles, `autoSell` ne vend PAS).
- **Jamais de mauvaise étiquette par défaut** : API KO → carte non classée (fast-path titre seulement), jamais de devinette.
- **Ne jamais dépasser** `maxBidWb`/`dailySpendCapWb` (bonus on-theme borné, mécanisme existant conservé).
- Filtres de catégories : `META_RE = /^(utilisateur|wikip[ée]dia|mod[èe]le|portail|projet|aide|cat[ée]gorie)\b|[ée]bauche|homonymie/i` et `BIO_RE = /^(naissance|d[ée]c[èe]s|mort)\b/i` — appliqués aux catégories de départ ET aux parents.
- Profondeurs : `interestDepthTag` défaut **3**, `interestDepthMarket` défaut **4** ; `maxFrontier` 200/niveau ; batch parents **50 titres/appel**.
- **Node dual-export** en fin de chaque module pur/testable.
- Ordre manifest final : `config, db, api, analysis, value, interest, enrich, ancestry, tagsync, engine, driver, dashboard` (lexicon supprimé).
- Suite verte à chaque tâche : `node --test test/*.test.js` (la forme `test/` seule est buguée — toujours le glob).

---

### Task 1: Config — profondeurs et budget

**Files:** Modify `src/config.js`

**Interfaces:** Produces `interestDepthTag:3`, `interestDepthMarket:4`, `ancestryFetchPerCycle:4`, `rootsTtlDays:90` ; Removes `vocabTtlDays`.

- [ ] **Step 1:** Dans `WMC_DEFAULTS`, remplacer la ligne `vocabTtlDays: 90, ...` par :

```js
  interestDepthTag: 3, // profondeur d'ascendance pour l'auto-tag (précision — banc: P86/R72)
  interestDepthMarket: 4, // profondeur pour repérage/auto-bid/protection (rappel — banc: P77/R80)
  ancestryFetchPerCycle: 4, // budget d'appels API "parents de catégories" par cycle (lots de 50)
  rootsTtlDays: 90, // TTL de la résolution des racines de catégorie par étiquette
```

- [ ] **Step 2:** `node --check src/config.js` → aucune sortie.
- [ ] **Step 3:** Commit : `git add src/config.js && git commit -m "feat(config): profondeurs d'ascendance + budget parents (S13)"`

---

### Task 2: `WMC_INTEREST` v2 — cœur pur de l'ascendance + tests

**Files:** Modify `src/interest.js`, Rewrite `test/interest.test.js`

**Interfaces:**
- Keeps: `normalize`, `STOPWORDS`, `matchable`, `nameWords` (inchangés).
- Removes: `compileVocab`, `classify` (et leurs tests).
- Produces:
  - `META_RE: RegExp`, `BIO_RE: RegExp`, `topicalCat(name) -> boolean`
  - `walkAncestry(startCats, rootsByTag, parentsOf, maxDepth, maxFrontier=200) -> {tagId: depth}` — `rootsByTag = [{tagId, roots: string[]}]`, `parentsOf: Map<string, string[]>`
  - `missingParents(startCats, parentsOf, maxDepth, maxFrontier=200) -> string[]`
  - `titleTags(card, tags) -> string[]` — `tags = [{tagId, name}]`

- [ ] **Step 1: Réécrire le fichier de test** — Replace `test/interest.test.js` par :

```js
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
  ["Duché de Normandie", ["Histoire de la Normandie"]],
  ["Histoire de la Normandie", ["Histoire de France par territoire"]],
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
```

- [ ] **Step 2:** `node --test test/interest.test.js` → FAIL (fonctions absentes).

- [ ] **Step 3: Implémenter** — dans `src/interest.js` : SUPPRIMER `escapeRe`, `compileVocab`, `sources`, `classify` et leurs mentions dans le `return`. AJOUTER après `nameWords` :

```js
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Catégories "meta" (maintenance/navigation Wikipédia) et biographiques
  // ("Naissance à X" : être né quelque part ≠ être à propos de ce lieu).
  const META_RE = /^(utilisateur|wikip[ée]dia|mod[èe]le|portail|projet|aide|cat[ée]gorie)\b|[ée]bauche|homonymie/i;
  const BIO_RE = /^(naissance|d[ée]c[èe]s|mort)\b/i;
  const topicalCat = (name) => !!name && !META_RE.test(name) && !BIO_RE.test(name);

  // Montée dans le graphe des catégories Wikipédia. Une carte matche un tag si
  // l'une de ses catégories est une DESCENDANTE d'une racine du tag (≤ maxDepth).
  // parentsOf: Map(nom de catégorie -> [parents]) — cache local, peut être partiel.
  // Renvoie {tagId: profondeur de la première atteinte} (0 = catégorie de départ).
  function walkAncestry(startCats, rootsByTag, parentsOf, maxDepth, maxFrontier = 200) {
    const rootLookup = new Map();
    for (const t of rootsByTag || [])
      for (const r of t.roots || []) if (!rootLookup.has(r)) rootLookup.set(r, t.tagId);
    const found = {};
    let frontier = [...new Set((startCats || []).filter(topicalCat))];
    const visited = new Set(frontier);
    for (const c of frontier) { const t = rootLookup.get(c); if (t && !(t in found)) found[t] = 0; }
    for (let d = 1; d <= maxDepth && frontier.length; d++) {
      const next = new Set();
      for (const c of frontier) for (const p of parentsOf.get(c) || []) {
        if (visited.has(p)) continue;
        visited.add(p);
        const t = rootLookup.get(p);
        if (t && !(t in found)) found[t] = d;
        next.add(p);
      }
      frontier = [...next].slice(0, maxFrontier);
    }
    return found;
  }

  // Catégories rencontrées pendant la montée dont les parents ne sont pas encore
  // en cache — c'est la liste de courses du backfill budgété.
  function missingParents(startCats, parentsOf, maxDepth, maxFrontier = 200) {
    const missing = new Set();
    let frontier = [...new Set((startCats || []).filter(topicalCat))];
    const visited = new Set(frontier);
    for (let d = 1; d <= maxDepth && frontier.length; d++) {
      const next = new Set();
      for (const c of frontier) {
        const ps = parentsOf.get(c);
        if (!ps) { missing.add(c); continue; }
        for (const p of ps) { if (!visited.has(p)) { visited.add(p); next.add(p); } }
      }
      frontier = [...next].slice(0, maxFrontier);
    }
    return [...missing];
  }

  // Fast-path sans réseau : les parts du nom du tag (nameWords) matchées en bord
  // de mot sur le TITRE de la carte. Sert tant que le graphe n'est pas en cache.
  function titleTags(card, tags) {
    const title = normalize(card && card.wikipedia_title);
    if (!title) return [];
    const out = [];
    for (const t of tags || []) {
      const parts = nameWords(t.name);
      if (parts.some((p) => new RegExp("\\b" + escapeRe(p) + "\\b").test(title))) out.push(t.tagId);
    }
    return out;
  }
```

Et remplacer le `return` du module par :

```js
  return { normalize, STOPWORDS, matchable, nameWords, META_RE, BIO_RE, topicalCat, walkAncestry, missingParents, titleTags };
```

- [ ] **Step 4:** `node --test test/interest.test.js` → PASS (8 tests).
- [ ] **Step 5:** Commit : `git add src/interest.js test/interest.test.js && git commit -m "feat(interest): ascendance de graphe pure + fast-path titre (S13)"`

> Note : `engine.js`/`dashboard.js` référencent encore `classify`/`compileVocab` — cassés jusqu'aux Tasks 4-5 (même branche, OK) ; la suite `node --test test/*.test.js` échouera sur lexicon.test.js jusqu'à la Task 5 (il teste l'ancien monde) — lancer les tests ciblés par fichier dans les Tasks 2-4.

---

### Task 3: DB v6 + `WMC_ANCESTRY`

**Files:** Modify `src/db.js` ; Create `src/ancestry.js` ; Create `test/ancestry.test.js` ; Modify `manifest.json` (ajouter `src/ancestry.js` entre `src/enrich.js` et `src/tagsync.js`)

**Interfaces:**
- `WMC_DB` (v6) : stores `cat_parents` {name, parents, fetchedAt} et `interest_roots` {name, resolved, added, removed, fetchedAt} ; suppression du store `interest_vocab` ; accesseurs `getCatParents(name)`, `putCatParents(row)`, `allCatParents()`, `getRoots(name)`, `putRoots(row)`.
- `WMC_ANCESTRY` : `resolveRoots(name)`, `rootsFor(tagName, cfg) -> string[]`, `addRoot(tagName, root)`, `removeRoot(tagName, root)`, `fillParents(names, maxCalls) -> nombre d'appels`, `parentsMap() -> Map`. Helper pur exporté : `parsePagesCategories(json) -> {[nomSansPrefixe]: string[]}`.

- [ ] **Step 1: db.js v6** — `const VERSION = 5;` → `6`. Dans `onupgradeneeded`, remplacer le bloc `interest_vocab` par :

```js
        // v6: l'ascendance de graphe remplace le vocabulaire rimessolides.
        if (db.objectStoreNames.contains("interest_vocab")) db.deleteObjectStore("interest_vocab");
        // Parents (topicaux) de chaque catégorie Wikipédia rencontrée — le graphe local.
        if (!db.objectStoreNames.contains("cat_parents")) {
          db.createObjectStore("cat_parents", { keyPath: "name" });
        }
        // Racines de catégorie par étiquette: résolues + ajouts/retraits de l'utilisateur.
        if (!db.objectStoreNames.contains("interest_roots")) {
          db.createObjectStore("interest_roots", { keyPath: "name" });
        }
```

Remplacer les méthodes `getVocab/putVocab/allVocab` par :

```js
    async getCatParents(name) {
      if (!name) return null;
      const db = await open();
      return new Promise((resolve) => {
        const req = db.transaction("cat_parents", "readonly").objectStore("cat_parents").get(name);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    },
    async putCatParents(row) {
      if (!row || !row.name) return;
      await tx("cat_parents", "readwrite", (s) => s.put({ fetchedAt: Date.now(), parents: [], ...row }));
    },
    async allCatParents() {
      return getAll("cat_parents").catch(() => []);
    },
    async getRoots(name) {
      if (!name) return null;
      const db = await open();
      return new Promise((resolve) => {
        const req = db.transaction("interest_roots", "readonly").objectStore("interest_roots").get(name);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    },
    async putRoots(row) {
      if (!row || !row.name) return;
      await tx("interest_roots", "readwrite", (s) => s.put({ fetchedAt: Date.now(), resolved: [], added: [], removed: [], ...row }));
    },
```

- [ ] **Step 2: test qui échoue** — Create `test/ancestry.test.js` :

```js
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
```

- [ ] **Step 3:** `node --test test/ancestry.test.js` → FAIL.

- [ ] **Step 4: Implémenter** — Create `src/ancestry.js` :

```js
// Ascendance de graphe Wikipédia — la couche I/O du classifieur S13.
// Résout les racines de catégorie de chaque étiquette et alimente le cache local
// des parents de catégories (lots de 50, API MediaWiki avec origin=* : CORS
// anonyme OK depuis le content-script, comme enrich.js). Aucun service worker.

const WMC_ANCESTRY = (() => {
  const API = "https://fr.wikipedia.org/w/api.php?action=query&format=json&origin=*&";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stripCat = (t) => (t || "").replace(/^Cat[ée]gorie:/, "");

  async function api(params) {
    for (let a = 0; a < 3; a++) {
      try {
        const r = await fetch(API + params);
        if (r.status === 429) { await sleep(4000 * (a + 1)); continue; }
        if (!r.ok) return null;
        return await r.json();
      } catch (_) { await sleep(1500); }
    }
    return null;
  }

  // Pur (testable): {titre de page sans préfixe -> [parents topicaux sans préfixe]}.
  function parsePagesCategories(json) {
    const out = {};
    for (const p of Object.values(json?.query?.pages || {})) {
      if (!p.title) continue;
      out[stripCat(p.title)] = (p.categories || [])
        .map((c) => stripCat(c.title))
        .filter((t) => WMC_INTEREST.topicalCat(t));
    }
    return out;
  }

  // Pur (testable): racines effectives = (résolues ∪ ajoutées) \ retirées.
  function effectiveRoots(row) {
    const removed = new Set(row?.removed || []);
    return [...new Set([...(row?.resolved || []), ...(row?.added || [])])].filter((r) => !removed.has(r));
  }

  async function catExists(n) {
    const j = await api("titles=" + encodeURIComponent("Catégorie:" + n));
    const p = Object.values(j?.query?.pages || {})[0] || {};
    const t = p.missing === undefined && p.title ? stripCat(p.title) : null;
    return t && WMC_INTEREST.topicalCat(t) ? t : null;
  }

  // Nom entier (sans parenthèses) s'il existe en catégorie, sinon par part:
  // existence directe puis recherche ns=14 (meilleur hit recouvrant le terme).
  async function resolveRoots(name) {
    const whole = (name || "").replace(/\([^)]*\)/g, "").trim();
    if (!whole) return [];
    const direct = await catExists(whole);
    if (direct) return [direct];
    const roots = [];
    for (const part of whole.split(/[&/,;]+/).map((s) => s.trim()).filter(Boolean)) {
      let r = await catExists(part);
      if (!r) {
        const j = await api("list=search&srnamespace=14&srlimit=8&srsearch=" + encodeURIComponent(part));
        const hits = (j?.query?.search || []).map((h) => stripCat(h.title)).filter((t) => WMC_INTEREST.topicalCat(t));
        const np = WMC_INTEREST.normalize(part);
        r = hits.find((t) => { const n = WMC_INTEREST.normalize(t); return n.includes(np) || np.includes(n); }) || hits[0] || null;
      }
      if (r) roots.push(r);
    }
    return roots;
  }

  // Racines effectives d'une étiquette, avec cache DB (TTL rootsTtlDays).
  async function rootsFor(tagName, cfg) {
    if (typeof WMC_DB === "undefined") return [];
    const ttl = (cfg && cfg.rootsTtlDays ? cfg.rootsTtlDays : 90) * 24 * 3600 * 1000;
    let row = await WMC_DB.getRoots(tagName).catch(() => null);
    if (!row || Date.now() - (row.fetchedAt || 0) > ttl || !(row.resolved || []).length) {
      const resolved = await resolveRoots(tagName);
      row = { name: tagName, resolved, added: (row && row.added) || [], removed: (row && row.removed) || [], fetchedAt: Date.now() };
      if (resolved.length) await WMC_DB.putRoots(row);
    }
    return effectiveRoots(row);
  }

  async function addRoot(tagName, root) {
    if (typeof WMC_DB === "undefined" || !root) return;
    const row = (await WMC_DB.getRoots(tagName).catch(() => null)) || { name: tagName, resolved: [], added: [], removed: [] };
    if (!row.added.includes(root)) row.added.push(root);
    row.removed = (row.removed || []).filter((r) => r !== root);
    await WMC_DB.putRoots(row);
  }
  async function removeRoot(tagName, root) {
    if (typeof WMC_DB === "undefined" || !root) return;
    const row = (await WMC_DB.getRoots(tagName).catch(() => null)) || { name: tagName, resolved: [], added: [], removed: [] };
    if (!row.removed.includes(root)) row.removed.push(root);
    row.added = (row.added || []).filter((r) => r !== root);
    await WMC_DB.putRoots(row);
  }

  // Parents topicaux par lots de 50 titres/appel (+ clcontinue), budget en nb d'appels.
  // Écrit cat_parents ; renvoie le nombre d'appels consommés.
  async function fillParents(names, maxCalls) {
    if (typeof WMC_DB === "undefined" || !names || !names.length) return 0;
    let calls = 0;
    for (let i = 0; i < names.length && calls < maxCalls; i += 50) {
      const chunk = names.slice(i, i + 50);
      const acc = {};
      let cont = "";
      do {
        const j = await api(
          "prop=categories&cllimit=500&clshow=!hidden" + cont +
          "&titles=" + encodeURIComponent(chunk.map((n) => "Catégorie:" + n).join("|"))
        );
        calls++;
        if (!j) break;
        const parsed = parsePagesCategories(j);
        for (const [name, parents] of Object.entries(parsed)) (acc[name] = acc[name] || []).push(...parents);
        cont = j?.continue?.clcontinue ? "&clcontinue=" + encodeURIComponent(j.continue.clcontinue) : "";
      } while (cont && calls < maxCalls);
      for (const n of chunk) await WMC_DB.putCatParents({ name: n, parents: [...new Set(acc[n] || [])] });
      await sleep(300);
    }
    return calls;
  }

  async function parentsMap() {
    if (typeof WMC_DB === "undefined") return new Map();
    const rows = await WMC_DB.allCatParents().catch(() => []);
    return new Map(rows.map((r) => [r.name, r.parents || []]));
  }

  return { parsePagesCategories, effectiveRoots, resolveRoots, rootsFor, addRoot, removeRoot, fillParents, parentsMap };
})();

if (typeof module !== "undefined" && module.exports) module.exports = WMC_ANCESTRY;
```

- [ ] **Step 5:** `node --test test/ancestry.test.js` → PASS (2 tests). `node --check src/db.js src/ancestry.js` → rien.
- [ ] **Step 6: Manifest** — dans `content_scripts[0].js`, ajouter `"src/ancestry.js",` juste après `"src/enrich.js",` (avant `"src/lexicon.js"` qui sera supprimé en Task 5).
- [ ] **Step 7:** Commit : `git add src/db.js src/ancestry.js test/ancestry.test.js manifest.json && git commit -m "feat(ancestry): racines par étiquette + graphe des parents (DB v6, batch 50)"`

---

### Task 4: `engine.js` — état interest, profondeurs, backfill ; `enrich.js` topical

**Files:** Modify `src/engine.js`, `src/enrich.js`

**Interfaces:**
- Consumes: `WMC_ANCESTRY.rootsFor/parentsMap/fillParents`, `WMC_INTEREST.walkAncestry/missingParents/titleTags`, `WMC_TAGSYNC.listTags`, flags Task 1.
- Produces: `interestState(cfg)`, `onThemeTags(card, meta, state, depth)`, job `ancestryBackfill(cfg)`. Supprime `interestVocab`/toute référence à `WMC_LEXICON`.

- [ ] **Step 1: enrich.js — catégories topicales.** Dans `fetchSignals`, dans l'URL de l'appel `api.php` (celle avec `prop=langlinks%7Clinkshere%7Ccategories`), ajouter `&redirects=1&clshow=!hidden` juste après `&format=json&origin=*`. (Les catégories cachées sont de la maintenance ; le walk et le GEEK-test n'en veulent pas.)

- [ ] **Step 2: engine.js — remplacer le bloc vocab.** Supprimer intégralement `vocabCache`/`interestVocab`/`onThemeTags` actuels et mettre à la place :

```js
  // État interest: tags de l'utilisateur + racines de catégorie par tag + graphe
  // local des parents. Cache mémoire 10 min (le backfill l'invalide en écrivant).
  let interestCache = { at: 0, tags: [], rootsByTag: [], parents: new Map() };
  const interestReady = () =>
    typeof WMC_TAGSYNC !== "undefined" && typeof WMC_ANCESTRY !== "undefined" &&
    typeof WMC_INTEREST !== "undefined" && typeof WMC_DB !== "undefined" && typeof document !== "undefined";
  async function interestState(cfg) {
    if (!interestReady()) return { tags: [], rootsByTag: [], parents: new Map() };
    if (Date.now() - interestCache.at < 600_000 && interestCache.rootsByTag.length) return interestCache;
    const tags = await WMC_TAGSYNC.listTags();
    const rootsByTag = [];
    for (const t of tags) rootsByTag.push({ tagId: t.id, roots: await WMC_ANCESTRY.rootsFor(t.name, cfg) });
    interestCache = {
      at: Date.now(),
      tags: tags.map((t) => ({ tagId: t.id, name: t.name })),
      rootsByTag,
      parents: await WMC_ANCESTRY.parentsMap(),
    };
    return interestCache;
  }
  const invalidateInterest = () => { interestCache.at = 0; };

  // Tags d'une carte: ascendance de graphe si on a ses catégories, sinon
  // fast-path titre (instantané, sans réseau). depth = curseur précision/rappel.
  const onThemeTags = (card, meta, state, depth) => {
    if (typeof WMC_INTEREST === "undefined" || !state.rootsByTag.length) return [];
    const cats = meta && Array.isArray(meta.categories) ? meta.categories : null;
    if (cats && cats.length)
      return Object.keys(WMC_INTEREST.walkAncestry(cats, state.rootsByTag, state.parents, depth));
    return WMC_INTEREST.titleTags(card, state.tags);
  };
```

- [ ] **Step 3: adapter les 4 comportements** (mêmes emplacements qu'avant, signatures ajustées) :
  - `snipeEndgame` : `const state = cfg.interestAutoBid ? await interestState(cfg) : { tags: [], rootsByTag: [], parents: new Map() };` puis dans la boucle value-gate : `a.__onTheme = onThemeTags(a.card, meta, state, cfg.interestDepthMarket ?? 4).length > 0;` (le reste — willingToPay 4ᵉ arg, tri `themed` — inchangé).
  - `autoSell` : le garde fail-closed devient `if (cfg.interestProtectSell && !interestReady()) return;`. Charger `const state = cfg.interestProtectSell ? await interestState(cfg) : { tags: [], rootsByTag: [], parents: new Map() };` et dans le filtre async de protection : `onThemeTags(c, meta, state, cfg.interestDepthMarket ?? 4)`.
  - `interestAutoTag` : `const state = await interestState(cfg); if (!state.rootsByTag.length) return;` ; boucle : `onThemeTags(c, meta, state, cfg.interestDepthTag ?? 3)` (le mapping `userCardId`/`assignTags`/dry-run inchangé).
  - `interestMarketScan` : idem avec `cfg.interestDepthMarket ?? 4`.

- [ ] **Step 4: job backfill** — ajouter après `interestMarketScan` :

```js
  // ---------- backfill du graphe (interest) ----------
  // Complète le cache des parents pour les cartes possédées (et le marché si le
  // repérage est actif), avec un budget d'appels par cycle. La couverture — donc
  // le rappel — augmente cycle après cycle ; le fast-path titre couvre l'attente.
  async function ancestryBackfill(cfg) {
    if (!(cfg.interestAutoTag || cfg.interestProtectSell || cfg.interestWatch || cfg.interestAutoBid)) return;
    if (!interestReady()) return;
    const state = await interestState(cfg);
    if (!state.rootsByTag.length) return;
    const depth = Math.max(cfg.interestDepthTag ?? 3, cfg.interestDepthMarket ?? 4);
    const missing = new Set();
    const collect = async (cards) => {
      for (const c of cards) {
        const meta = await cardMeta(c);
        const cats = meta && Array.isArray(meta.categories) ? meta.categories : null;
        if (!cats || !cats.length) continue;
        for (const m of WMC_INTEREST.missingParents(cats, state.parents, depth)) missing.add(m);
        if (missing.size > 400) break; // assez de travail pour ce cycle
      }
    };
    await collect(((await WMC_API.ownedCards().catch(() => ({ cards: [] }))).cards) || []);
    if (cfg.interestWatch || cfg.interestAutoBid)
      await collect((await getAuctions().catch(() => [])).map((a) => a.card).filter(Boolean));
    if (!missing.size) return;
    const calls = await WMC_ANCESTRY.fillParents([...missing], cfg.ancestryFetchPerCycle ?? 4);
    if (calls) invalidateInterest(); // de nouveaux parents sont en cache
  }
```

- [ ] **Step 5:** dans `runCycle`, ajouter `() => ancestryBackfill(cfg),` à la liste `jobs` (après `interestMarketScan`).
- [ ] **Step 6:** `node --check src/engine.js src/enrich.js` → rien. Vérifier qu'il ne reste AUCUNE référence à `WMC_LEXICON`/`interestVocab`/`classify` dans engine.js : `grep -n "WMC_LEXICON\|interestVocab\|classify" src/engine.js` → vide.
- [ ] **Step 7:** Commit : `git add src/engine.js src/enrich.js && git commit -m "feat(engine): classifieur par ascendance (2 profondeurs) + backfill budgété"`

---

### Task 5: Dashboard racines éditables + suppression de la voie rimessolides

**Files:** Modify `src/dashboard.js`, `src/background.js`, `manifest.json` ; Delete `src/lexicon.js`, `test/lexicon.test.js`

- [ ] **Step 1: dashboard — contrôles.** Dans `CONTROLS`, remplacer `{ k: "interestBidBonus", ... }` par :

```js
    { k: "interestBidBonus", label: "Bonus mise on-theme (WB)", num: true },
    { k: "interestDepthTag", label: "Profondeur auto-tag (3 = précis)", num: true },
    { k: "interestDepthMarket", label: "Profondeur marché (4 = rappel)", num: true },
```

- [ ] **Step 2: dashboard — section thèmes v2.** Remplacer intégralement le bloc `themeSection` du `render()` (calcul + chips vocab) par :

```js
    let themeSection = "";
    if (typeof WMC_TAGSYNC !== "undefined" && typeof WMC_ANCESTRY !== "undefined" && typeof WMC_INTEREST !== "undefined") {
      const tags = await WMC_TAGSYNC.listTags().catch(() => []);
      const metaByTitle = {};
      for (const m of await WMC_DB.allCardMeta().catch(() => [])) metaByTitle[m.title] = m;
      const parents = await WMC_ANCESTRY.parentsMap();
      const rootsByName = {};
      const rootsByTag = [];
      for (const t of tags) {
        const roots = await WMC_ANCESTRY.rootsFor(t.name, cfg).catch(() => []);
        rootsByName[t.id] = { name: t.name, color: t.color, roots };
        rootsByTag.push({ tagId: t.id, roots });
      }
      const counts = {};
      for (const c of cards) {
        const meta = metaByTitle[c.wikipedia_title] || null;
        const cats = meta && Array.isArray(meta.categories) ? meta.categories : [];
        for (const id of Object.keys(WMC_INTEREST.walkAncestry(cats, rootsByTag, parents, cfg.interestDepthTag ?? 3)))
          counts[id] = (counts[id] || 0) + 1;
      }
      themeSection = tags
        .map((t) => {
          const info = rootsByName[t.id];
          const safeColor = /^#[0-9a-f]{6}$/i.test(t.color || "") ? t.color : "#334155";
          const chips = info.roots
            .map((r) => `<span class="kw" data-tag="${esc(t.name)}" data-r="${esc(r)}" title="Cliquer pour retirer cette racine">${esc(r)}×</span>`)
            .join(" ");
          return `<tr><td><span class="pill" style="background:${safeColor}22;color:${safeColor}">${esc(t.name)}</span></td><td class="r">${counts[t.id] || 0}</td></tr>
                  <tr><td colspan="2" class="kws">${chips || '<span class="muted">racines en cours de résolution…</span>'}
                    <input type="text" class="kw-add" data-tag="${esc(t.name)}" placeholder="+ racine (nom de catégorie)"></td></tr>`;
        })
        .join("");
    }
```

- [ ] **Step 3: dashboard — câblage.** Dans `wireControls(p)`, remplacer le bloc `.kw` (removeWord) par :

```js
    p.querySelectorAll(".kw").forEach((chip) =>
      chip.addEventListener("click", async () => {
        await WMC_ANCESTRY.removeRoot(chip.dataset.tag, chip.dataset.r);
        chip.remove();
        wmcToast("Racines", `« ${chip.dataset.r} » retirée de « ${chip.dataset.tag} ».`);
      })
    );
    p.querySelectorAll(".kw-add").forEach((input) =>
      input.addEventListener("keydown", async (ev) => {
        if (ev.key !== "Enter" || !input.value.trim()) return;
        await WMC_ANCESTRY.addRoot(input.dataset.tag, input.value.trim());
        wmcToast("Racines", `« ${input.value.trim()} » ajoutée à « ${input.dataset.tag} ».`);
        input.value = "";
      })
    );
```

Et dans le CSS, après les règles `.kw`, ajouter :

```css
    #wmc-panel .kw-add{width:100%;margin-top:3px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e5e7eb;font-size:11px;padding:2px 6px}
```

Mettre à jour la légende sous la table « Tes thèmes » : `Comptes = cartes dont une catégorie Wikipédia descend d'une racine (profondeur ${cfg.interestDepthTag ?? 3}). Clique une racine pour la retirer, Entrée pour en ajouter.`

- [ ] **Step 4: suppressions.** `git rm src/lexicon.js test/lexicon.test.js`. Dans `manifest.json` : retirer `"src/lexicon.js",` de `content_scripts` et retirer `"https://www.rimessolides.com/*"` de `host_permissions`. Dans `src/background.js` : supprimer tout le bloc `chrome.runtime.onMessage.addListener` du handler `rimes`.
- [ ] **Step 5:** Vérifs : `node --check src/dashboard.js src/background.js` → rien. `grep -rn "LEXICON\|lexicon\|rimessolides\|rimes" src/ manifest.json` → vide. `node -e "const j=JSON.parse(require('fs').readFileSync('manifest.json','utf8'));const cs=j.content_scripts[0].js;console.log(cs.join(','))"` → ordre `…,src/interest.js,src/enrich.js,src/ancestry.js,src/tagsync.js,src/engine.js,…`.
- [ ] **Step 6:** Suite complète : `node --test test/*.test.js` → PASS (interest 8, ancestry 2, enrich 1, tagsync 3).
- [ ] **Step 7:** Commit : `git add -A && git commit -m "feat(dashboard): racines éditables + retrait de la voie rimessolides"`

---

### Task 6: Régression banc + vérification live

**Files:** Create `tools/regression-s13.mjs` (dans le repo, réutilisable)

- [ ] **Step 1:** Create `tools/regression-s13.mjs` — rejoue l'éval du banc (35 cartes) avec le `walkAncestry` DE PROD et le cache du banc :

```js
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
```

- [ ] **Step 2:** Run: `node tools/regression-s13.mjs /private/tmp/claude-501/-Users-j0j0-mephisto/8176ece6-ec10-48e2-9822-5e9b97cfcd14/scratchpad/bench-cache.json`
Expected: `F1 78%` (± arrondi) puis `OK — conforme au banc.`
- [ ] **Step 3:** Commit : `git add tools/regression-s13.mjs && git commit -m "test(regression): éval S13 du banc rejouée avec le code de prod"`
- [ ] **Step 4 (manuel, utilisateur):** recharger l'extension, dry-run ON + auto-étiquetage ON, vérifier : racines visibles dans « Tes thèmes », comptes qui montent au fil des cycles (backfill), notif dry-run, puis passage réel et vérification de Mathilde de Flandre sur /collection.

---

## Self-Review

**Couverture spec :** §3.1→Task 2 ; §3.2→Task 3 ; §3.3→Task 3 ; §3.4+enrich→Task 4 ; §3.5→Task 5 ; §3.6 suppressions→Task 5 ; §4 config→Task 1 ; §6 tests purs→Tasks 2-3, régression→Task 6, live→Task 6 step 4. ✅
**Placeholders :** aucun — code complet partout.
**Cohérence :** `rootsByTag=[{tagId,roots}]` identique interest/ancestry/engine/dashboard/regression ; `parentsOf: Map` partout ; `topicalCat` consommé par ancestry (global `WMC_INTEREST`, chargé avant dans le manifest, et via `globalThis` dans les tests) ; depth tag=3/market=4 cohérents config/engine/dashboard ; fail-closed conservé (interestReady inclut document+ANCESTRY).
