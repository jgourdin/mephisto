# Ciblage par thèmes dynamiques (« Interest targeting ») — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classer/étiqueter les cartes selon les étiquettes **propres à chaque utilisateur** (lues dans Supabase), avec un vocabulaire **auto-dérivé** de rimessolides.com (mis en cache, éditable), sans aucun thème en dur, alimentant 4 comportements : repérage marché, priorité auto-bid, auto-étiquetage, protection anti-vente.

**Architecture:** `WMC_INTEREST` (pur) matche une carte à un tag si les catégories Wikipédia + le titre contiennent un mot du vocabulaire du tag. `WMC_LEXICON` construit ce vocabulaire par tag = mots rimessolides (fetchés par le **service worker**, CORS oblige) ∪ mots du nom, filtrés (mode Prudent), moins les mots retirés par l'utilisateur, en cache DB. `WMC_TAGSYNC.listTags` lit les tags de l'utilisateur. `engine.js` branche les 4 comportements ; `dashboard.js` affiche les comptes + le vocabulaire éditable.

**Tech Stack:** JS navigateur (extension MV3, modules IIFE globaux `WMC_*`). Tests via `node --test` (Node 22, zéro dépendance) sur les modules purs. I/O validés en `dryRun` live.

## Global Constraints

- **Zéro thème/vocabulaire en dur.** Tout dérive des tags de l'utilisateur + rimessolides.
- **Off par défaut** : `interestWatch`, `interestAutoBid`, `interestAutoTag` = `false` ; `interestProtectSell` = `true`.
- **Respecter `dryRun`** ; **ne jamais dépasser** `maxBidWb`/`dailySpendCapWb`.
- **Fetch rimessolides = service worker uniquement** (CORS bloqué en content-script) + `host_permissions: "https://www.rimessolides.com/*"`. N'envoie que le mot du tag.
- **Jeton de session jamais loggé/exposé.**
- **Mode Prudent** : mots ≥4 lettres (≥3 pour les mots issus du **nom** du tag), bord de mot, liste noire FR, matching sur **catégories Wikipédia + titre** seulement.
- **Ordre `manifest.json` content_scripts** : `config, db, api, analysis, value, interest, enrich, lexicon, tagsync, engine, driver, dashboard`.
- **Node dual-export** en fin de chaque module pur : `if (typeof module !== "undefined" && module.exports) module.exports = WMC_X;`.

---

### Task 1: Flags de configuration

**Files:** Modify `src/config.js` (`WMC_DEFAULTS`, avant `// --- Cadence`)

**Interfaces:** Produces flags lus partout : `interestWatch`, `interestAutoBid`, `interestAutoTag`, `interestProtectSell:boolean`, `interestBidBonus:number`, `vocabTtlDays:number`.

- [ ] **Step 1: Ajouter les flags**

```js
  // --- Interest targeting (ciblage par thèmes, dynamique par utilisateur) ---
  interestWatch: false, // surligne/notifie au marché les cartes on-theme
  interestAutoBid: false, // priorité auto-bid on-theme (dans les plafonds)
  interestAutoTag: false, // auto-étiquette les cartes possédées (respecte dryRun)
  interestProtectSell: true, // ne jamais auto-vendre/défausser une carte on-theme
  interestBidBonus: 20, // WB ajoutés au plafond d'une carte on-theme, borné par maxBidWb
  vocabTtlDays: 90, // durée de cache du vocabulaire rimessolides par étiquette
```

- [ ] **Step 2: Vérifier** — Run: `node --check src/config.js` — Expected: aucune sortie.
- [ ] **Step 3: Commit**

```bash
git add src/config.js && git commit -m "feat(config): flags interest targeting dynamique"
```

---

### Task 2: `WMC_INTEREST` — matching pur + tests

**Files:** Create `src/interest.js`, `test/interest.test.js` ; Modify `manifest.json` (ajouter `src/interest.js` après `src/value.js`).

**Interfaces:**
- Produces:
  - `WMC_INTEREST.normalize(s) -> string`
  - `WMC_INTEREST.STOPWORDS: Set<string>`
  - `WMC_INTEREST.matchable(word, minLen=4) -> boolean`
  - `WMC_INTEREST.nameWords(name) -> string[]` (mots significatifs d'un nom de tag, seuil ≥3)
  - `WMC_INTEREST.compileVocab(tags) -> [{tagId, re:RegExp}]` — `tags=[{tagId, words:string[]}]`
  - `WMC_INTEREST.classify(card, meta, compiled) -> string[]` — tagIds qui matchent (catégories Wikipédia + titre)

- [ ] **Step 1: Test qui échoue** — Create `test/interest.test.js`:

```js
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
```

- [ ] **Step 2: Lancer, vérifier l'échec** — Run: `node --test test/interest.test.js` — Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter** — Create `src/interest.js`:

```js
// Matching d'intérêts — PUR, sans IA, sans thème en dur. Une carte matche un tag
// si ses catégories Wikipédia (ou son titre) contiennent un mot du vocabulaire du
// tag (bord de mot, texte normalisé). Le vocabulaire vient de lexicon.js.

const WMC_INTEREST = (() => {
  const normalize = (s) =>
    (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  // Mots trop génériques du champ lexical (bruit). Volontairement court : le mode
  // "liste éditable" laisse l'utilisateur retirer d'autres mots au cas par cas.
  const STOPWORDS = new Set([
    "tome", "tomes", "volume", "volumes", "serie", "series", "saison", "saisons",
    "film", "films", "roman", "romans", "album", "albums", "genre", "genres",
    "titre", "titres", "page", "pages", "oeuvre", "oeuvres", "style", "annee",
    "annees", "siecle", "edition", "editions", "liste", "type", "types", "partie",
    "nom", "noms", "mot", "mots", "forme", "auteur", "auteurs", "autrice",
  ]);

  const matchable = (word, minLen = 4) =>
    typeof word === "string" && word.length >= minLen && !STOPWORDS.has(word);

  // Mots significatifs d'un nom de tag (seuil 3, on garde les noms intentionnels).
  // Sépare sur & / , ; garde chaque part composée (ex. "val-de-marne") ET ses tokens.
  function nameWords(name) {
    const out = new Set();
    const parts = normalize(name)
      .replace(/\([^)]*\)/g, " ")
      .split(/[&/,;]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    for (const p of parts) {
      if (matchable(p, 3)) out.add(p);
      for (const tok of p.split(/[^a-z0-9]+/)) if (matchable(tok, 3)) out.add(tok);
    }
    return [...out];
  }

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Précompile un regex alternation par tag (bord de mot). tags=[{tagId, words[]}].
  function compileVocab(tags) {
    return (tags || [])
      .map((t) => {
        const words = [...new Set((t.words || []).map(normalize).filter(Boolean))];
        if (!words.length) return null;
        return { tagId: t.tagId, re: new RegExp("\\b(" + words.map(escapeRe).join("|") + ")\\b") };
      })
      .filter(Boolean);
  }

  // Sources de matching : catégories Wikipédia (si enrichi) + titre. JAMAIS la
  // description libre (bruit).
  function sources(card, meta) {
    const srcs = [];
    if (meta && Array.isArray(meta.categories)) for (const c of meta.categories) srcs.push(normalize(c));
    if (card && card.wikipedia_title) srcs.push(normalize(card.wikipedia_title));
    return srcs;
  }

  function classify(card, meta, compiled) {
    const srcs = sources(card, meta);
    const hits = [];
    for (const t of compiled || []) if (srcs.some((s) => t.re.test(s))) hits.push(t.tagId);
    return hits;
  }

  return { normalize, STOPWORDS, matchable, nameWords, compileVocab, classify };
})();

if (typeof module !== "undefined" && module.exports) module.exports = WMC_INTEREST;
```

- [ ] **Step 4: Lancer, vérifier le succès** — Run: `node --test test/interest.test.js` — Expected: PASS (6 tests).
- [ ] **Step 5: Manifest** — ajouter `"src/interest.js",` après `"src/value.js",`. Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')).content_scripts[0].js.includes('src/interest.js')||process.exit(1)" && echo OK` — Expected: `OK`.
- [ ] **Step 6: Commit**

```bash
git add src/interest.js test/interest.test.js manifest.json
git commit -m "feat(interest): matching pur carte→tag (vocabulaire dynamique)"
```

---

### Task 3: `enrich.js` conserve les catégories Wikipédia

**Files:** Modify `src/enrich.js` ; Create `test/enrich.test.js`

**Interfaces:** Produces `fetchSignals` → `{...signaux, categories:string[]}` ; `WMC_ENRICH.cleanCategoryTitles(pageCats)->string[]` (pur) ; `enrichSeen(cards, max, opts?)` avec `opts.rarities` (défaut `["UR","L"]`).

- [ ] **Step 1: Test qui échoue** — Create `test/enrich.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const E = require("../src/enrich.js");

test("cleanCategoryTitles retire 'Catégorie:'/'Category:' et les vides", () => {
  assert.deepStrictEqual(
    E.cleanCategoryTitles([{ title: "Catégorie:Maison de Flandre" }, { title: "Category:Nobility" }, { title: "Duchesse de Normandie" }, { title: "" }, {}]),
    ["Maison de Flandre", "Nobility", "Duchesse de Normandie"]
  );
});
```

- [ ] **Step 2: Lancer, vérifier l'échec** — Run: `node --test test/enrich.test.js` — Expected: FAIL.

- [ ] **Step 3: Implémenter** — dans `src/enrich.js` :

(a) Après la déclaration de `GEEK`, ajouter :

```js
  const cleanCategoryTitles = (cats) =>
    (cats || [])
      .map((c) => (c && c.title ? c.title.replace(/^(Cat[ée]gorie|Category)\s*:\s*/i, "").trim() : ""))
      .filter(Boolean);
```

(b) Dans `fetchSignals`, ajouter `let categories = [];` près de `let langCount = 0;`. Dans le `try`, remplacer la ligne `geekCat = (p.categories || [])...` par :

```js
      categories = cleanCategoryTitles(p.categories);
      geekCat = categories.some((c) => GEEK.test(c));
```

(c) Remplacer le `return { langCount, backlinks, geekCat, spikeRatio, pvMedian };` par :

```js
    return { langCount, backlinks, geekCat, spikeRatio, pvMedian, categories };
```

(d) `enrichSeen` — signature + filtre + re-fetch des entrées sans catégories :

```js
  async function enrichSeen(cards, max, opts) {
    if (typeof WMC_DB === "undefined") return;
    const rarities = (opts && opts.rarities) || ["UR", "L"];
    const seen = new Set();
    const todo = [];
    for (const c of cards || []) {
      const title = c && c.wikipedia_title;
      if (!title || seen.has(title)) continue;
      if (!rarities.includes(c.rarity)) continue;
      seen.add(title);
      const cached = await WMC_DB.getCardMeta(title).catch(() => null);
      if (cached && Date.now() - (cached.fetchedAt || 0) < TTL && Array.isArray(cached.categories)) continue;
      todo.push({ title, lang: c.lang });
    }
```

(reste inchangé)

(e) Export — remplacer `return { fetchSignals, enrichSeen, GEEK };` par :

```js
  return { fetchSignals, enrichSeen, GEEK, cleanCategoryTitles };
})();

if (typeof module !== "undefined" && module.exports) module.exports = WMC_ENRICH;
```

- [ ] **Step 4: Lancer, vérifier le succès** — Run: `node --test test/enrich.test.js` — Expected: PASS.
- [ ] **Step 5: Vérif syntaxe** — Run: `node --check src/enrich.js` — Expected: aucune sortie.
- [ ] **Step 6: Commit**

```bash
git add src/enrich.js test/enrich.test.js
git commit -m "feat(enrich): conserve les catégories Wikipédia + portée paramétrable"
```

---

### Task 4: Store DB `interest_vocab`

**Files:** Modify `src/db.js`

**Interfaces:** Produces `WMC_DB.getVocab(name)`, `putVocab(row)`, `allVocab()`. Store `interest_vocab` keyPath `name`. `VERSION` 4 → 5.

- [ ] **Step 1: Bump version** — dans `src/db.js`, remplacer `const VERSION = 4;` par `const VERSION = 5;`.

- [ ] **Step 2: Créer le store** — dans `onupgradeneeded`, après le bloc `card_meta`, ajouter :

```js
        // Vocabulaire de matching par étiquette (mots rimessolides ∪ nom, filtrés,
        // moins les mots retirés par l'utilisateur) + horodatage de cache.
        if (!db.objectStoreNames.contains("interest_vocab")) {
          db.createObjectStore("interest_vocab", { keyPath: "name" });
        }
```

- [ ] **Step 3: API** — dans l'objet retourné (après les méthodes `card_meta`), ajouter :

```js
    async getVocab(name) {
      if (!name) return null;
      const db = await open();
      return new Promise((resolve) => {
        const req = db.transaction("interest_vocab", "readonly").objectStore("interest_vocab").get(name);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    },
    async putVocab(row) {
      if (!row || !row.name) return;
      await tx("interest_vocab", "readwrite", (s) => s.put({ fetchedAt: Date.now(), removed: [], words: [], ...row }));
    },
    async allVocab() {
      return getAll("interest_vocab").catch(() => []);
    },
```

- [ ] **Step 4: Vérif syntaxe** — Run: `node --check src/db.js` — Expected: aucune sortie.
- [ ] **Step 5: Commit**

```bash
git add src/db.js && git commit -m "feat(db): store interest_vocab (v5)"
```

---

### Task 5: `WMC_LEXICON` (vocabulaire rimessolides) + fetch background + permission

**Files:** Create `src/lexicon.js`, `test/lexicon.test.js` ; Modify `src/background.js`, `manifest.json`.

**Interfaces:**
- Consumes: `WMC_INTEREST.{normalize,matchable,nameWords}`, `WMC_DB.{getVocab,putVocab}`, message background `{type:"rimes", word}`.
- Produces:
  - `WMC_LEXICON.parseRimes(html) -> string[]` (pur)
  - `WMC_LEXICON.buildVocab(tag, cfg) -> Promise<string[]>` (cache-first ; fetch via background ; ∪ nameWords ; filtre ; \ removed)
  - `WMC_LEXICON.removeWord(name, word) -> Promise<void>` (ajoute à `removed`, recache)
  - Background : handler `{type:"rimes", word}` → `{ok, html}`.

- [ ] **Step 1: Test qui échoue** — Create `test/lexicon.test.js`:

```js
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
```

- [ ] **Step 2: Lancer, vérifier l'échec** — Run: `node --test test/lexicon.test.js` — Expected: FAIL.

- [ ] **Step 3: Implémenter** — Create `src/lexicon.js`:

```js
// Construit le vocabulaire de matching par étiquette. Source : rimessolides.com
// (champ lexical d'un mot), fetché par le SERVICE WORKER (CORS bloqué en page),
// ∪ les mots du nom de l'étiquette, filtré (mode Prudent), moins les mots retirés
// par l'utilisateur. Mis en cache dans la DB. Content-script.

const WMC_LEXICON = (() => {
  // Extrait les mots des liens <a href="motscles.aspx?m=...">MOT</a> (pur).
  function parseRimes(html) {
    const out = [];
    const re = /<a[^>]+href=["']?motscles\.aspx\?m=[^"'>]*["']?[^>]*>([^<]+)<\/a>/gi;
    let m;
    while ((m = re.exec(html || "")) !== null) {
      const w = m[1].replace(/\s+/g, " ").trim();
      if (w) out.push(w);
    }
    return out;
  }

  // Demande au service worker de fetcher rimessolides (permission d'hôte).
  function fetchRimes(word) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "rimes", word }, (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.ok) return resolve([]);
          resolve(parseRimes(resp.html));
        });
      } catch (_) {
        resolve([]);
      }
    });
  }

  // Vocabulaire d'un tag : cache-first, sinon fetch rimessolides pour chaque mot
  // du nom + union avec les mots du nom, filtré (Prudent), moins `removed`.
  async function buildVocab(tag, cfg) {
    const name = tag && tag.name;
    if (!name) return [];
    const ttl = (cfg && cfg.vocabTtlDays ? cfg.vocabTtlDays : 90) * 24 * 3600 * 1000;
    const cached = typeof WMC_DB !== "undefined" ? await WMC_DB.getVocab(name).catch(() => null) : null;
    if (cached && Date.now() - (cached.fetchedAt || 0) < ttl) {
      return applyFilter(cached.words, cached.removed);
    }
    const nameWords = WMC_INTEREST.nameWords(name);
    const raw = new Set(nameWords);
    for (const seed of nameWords) {
      const rimes = await fetchRimes(seed);
      for (const w of rimes) raw.add(WMC_INTEREST.normalize(w));
    }
    const removed = (cached && cached.removed) || [];
    const words = [...raw];
    if (typeof WMC_DB !== "undefined") await WMC_DB.putVocab({ name, words, removed, fetchedAt: Date.now() });
    return applyFilter(words, removed);
  }

  // Filtre Prudent : ≥4 lettres (les mots du nom passent déjà à ≥3 via nameWords,
  // conservés ici via une seconde chance), pas stopword, pas retiré.
  function applyFilter(words, removed) {
    const rm = new Set((removed || []).map(WMC_INTEREST.normalize));
    return [...new Set((words || []).map(WMC_INTEREST.normalize))]
      .filter((w) => w && !rm.has(w) && (WMC_INTEREST.matchable(w) || WMC_INTEREST.matchable(w, 3)));
  }

  async function removeWord(name, word) {
    if (typeof WMC_DB === "undefined") return;
    const row = (await WMC_DB.getVocab(name).catch(() => null)) || { name, words: [], removed: [] };
    const w = WMC_INTEREST.normalize(word);
    if (!row.removed.includes(w)) row.removed.push(w);
    await WMC_DB.putVocab(row);
  }

  return { parseRimes, fetchRimes, buildVocab, removeWord, applyFilter };
})();

if (typeof module !== "undefined" && module.exports) module.exports = WMC_LEXICON;
```

- [ ] **Step 4: Lancer, vérifier le succès** — Run: `node --test test/lexicon.test.js` — Expected: PASS.

- [ ] **Step 5: Handler background** — dans `src/background.js`, ajouter avant la dernière ligne :

```js
// Fetch rimessolides pour le vocabulaire d'étiquette (CORS bloqué en content-script ;
// le SW y a droit via host_permissions). Renvoie le HTML brut au content-script.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "rimes" && msg.word) {
    const url = "https://www.rimessolides.com/motscles.aspx?m=" + encodeURIComponent(msg.word);
    fetch(url)
      .then((r) => (r.ok ? r.text() : ""))
      .then((html) => sendResponse({ ok: !!html, html }))
      .catch(() => sendResponse({ ok: false, html: "" }));
    return true; // réponse asynchrone
  }
});
```

- [ ] **Step 6: Manifest** — (a) `host_permissions` : `["https://www.wiki-masters.com/*", "https://www.rimessolides.com/*"]`. (b) ajouter `"src/lexicon.js",` dans `content_scripts[0].js` **juste après** `"src/enrich.js",`.

Run: `node -e "const j=JSON.parse(require('fs').readFileSync('manifest.json','utf8')); const cs=j.content_scripts[0].js; if(!j.host_permissions.includes('https://www.rimessolides.com/*'))process.exit(2); if(cs.indexOf('src/enrich.js')>cs.indexOf('src/lexicon.js'))process.exit(3); console.log('OK')"`
Expected: `OK`.

- [ ] **Step 7: Commit**

```bash
git add src/lexicon.js test/lexicon.test.js src/background.js manifest.json
git commit -m "feat(lexicon): vocabulaire rimessolides (fetch background + cache + édition)"
```

---

### Task 6: `WMC_TAGSYNC` — lire les tags de l'utilisateur

**Files:** Modify `src/tagsync.js` (créé au design initial) OU Create s'il n'existe pas ; Modify `manifest.json` (ajouter `src/tagsync.js` après `src/lexicon.js`) ; Create `test/tagsync.test.js`.

> Note : si `src/tagsync.js` a été créé par un plan antérieur avec `ensureThemeTags`, **supprimer `ensureThemeTags`** (plus de création hardcodée) et ajouter `listTags`.

**Interfaces:**
- Produces: `parseAuthToken(cookie)`, `jwtSub(token)` (purs) ; `listTags() -> Promise<[{id,name,color}]>` ; `listAssignments() -> Promise<Set>` ; `assignTags(pairs, dryRun) -> Promise<{ok,count}>`.

- [ ] **Step 1: Test qui échoue** — Create `test/tagsync.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const T = require("../src/tagsync.js");

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (p) => `${b64({ alg: "ES256" })}.${b64(p)}.sig`;

test("parseAuthToken lit un cookie base64- non chunké", () => {
  const at = jwt({ sub: "u1" });
  const val = "base64-" + Buffer.from(JSON.stringify({ access_token: at })).toString("base64");
  assert.strictEqual(T.parseAuthToken("x=1; sb-ref-auth-token=" + encodeURIComponent(val)), at);
});

test("parseAuthToken recompose .0/.1", () => {
  const at = jwt({ sub: "u2" });
  const raw = "base64-" + Buffer.from(JSON.stringify({ access_token: at })).toString("base64");
  const mid = Math.floor(raw.length / 2);
  const c = "sb-ref-auth-token.0=" + encodeURIComponent(raw.slice(0, mid)) + "; sb-ref-auth-token.1=" + encodeURIComponent(raw.slice(mid));
  assert.strictEqual(T.parseAuthToken(c), at);
});

test("jwtSub extrait sub", () => {
  assert.strictEqual(T.jwtSub(jwt({ sub: "abc" })), "abc");
});
```

- [ ] **Step 2: Lancer, vérifier l'échec** — Run: `node --test test/tagsync.test.js` — Expected: FAIL (module introuvable ou fonction absente).

- [ ] **Step 3: Implémenter** — Create/replace `src/tagsync.js`:

```js
// Client des étiquettes WikiMasters (base Supabase de l'utilisateur). Lit la
// session dans le cookie supabase-ssr (JAMAIS loggée). Content-script.

const WMC_TAGSYNC = (() => {
  const REF = "cyrxjeppjqsxxjayfrur";
  const BASE = "https://" + REF + ".supabase.co/rest/v1";
  const ANON =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5cnhqZXBwanFzeHhqYXlmcnVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4ODAzMzksImV4cCI6MjA4OTQ1NjMzOX0.BZluyXygNxuQGDPxFX1zG5i-cqp10CVK-8GGtuak4Rg";

  function parseAuthToken(cookieString) {
    const cookies = {};
    (cookieString || "").split("; ").forEach((c) => {
      const i = c.indexOf("=");
      if (i > 0) cookies[c.slice(0, i)] = decodeURIComponent(c.slice(i + 1));
    });
    const keys = Object.keys(cookies).filter((k) => k.includes("-auth-token"));
    if (!keys.length) return null;
    keys.sort((a, b) => {
      const sa = a.match(/\.(\d+)$/), sb = b.match(/\.(\d+)$/);
      return (sa ? +sa[1] : 0) - (sb ? +sb[1] : 0);
    });
    let raw = keys.map((k) => cookies[k]).join("");
    if (raw.startsWith("base64-")) { try { raw = atob(raw.slice(7)); } catch (_) { return null; } }
    let s; try { s = JSON.parse(raw); } catch (_) { return null; }
    if (Array.isArray(s)) s = s[0];
    return s && s.access_token ? s.access_token : null;
  }

  function jwtSub(token) {
    try {
      return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub || null;
    } catch (_) { return null; }
  }

  const auth = () => {
    const token = typeof document !== "undefined" ? parseAuthToken(document.cookie) : null;
    if (!token) return null;
    return { uid: jwtSub(token), headers: { apikey: ANON, authorization: "Bearer " + token, "content-type": "application/json" } };
  };

  async function listTags() {
    const a = auth();
    if (!a || !a.uid) return [];
    return fetch(`${BASE}/tags?select=id,name,color&user_id=eq.${a.uid}&order=name.asc`, { headers: a.headers })
      .then((r) => (r.ok ? r.json() : [])).catch(() => []);
  }

  async function listAssignments() {
    const a = auth();
    if (!a) return new Set();
    const rows = await fetch(`${BASE}/user_card_tags?select=user_card_id,tag_id`, { headers: a.headers })
      .then((r) => (r.ok ? r.json() : [])).catch(() => []);
    return new Set(rows.map((r) => `${r.user_card_id}|${r.tag_id}`));
  }

  async function assignTags(pairs, dryRun) {
    if (!pairs || !pairs.length) return { ok: true, count: 0 };
    if (dryRun) return { ok: true, count: pairs.length };
    const a = auth();
    if (!a) return { ok: false, count: 0 };
    const res = await fetch(`${BASE}/user_card_tags`, {
      method: "POST",
      headers: { ...a.headers, Prefer: "return=minimal,resolution=merge-duplicates" },
      body: JSON.stringify(pairs),
    }).catch(() => null);
    return { ok: !!(res && res.ok), count: res && res.ok ? pairs.length : 0 };
  }

  return { parseAuthToken, jwtSub, listTags, listAssignments, assignTags };
})();

if (typeof module !== "undefined" && module.exports) module.exports = WMC_TAGSYNC;
```

- [ ] **Step 4: Lancer, vérifier le succès** — Run: `node --test test/tagsync.test.js` — Expected: PASS.
- [ ] **Step 5: Manifest** — ajouter `"src/tagsync.js",` **juste après** `"src/lexicon.js",`. Run: `node -e "const cs=JSON.parse(require('fs').readFileSync('manifest.json','utf8')).content_scripts[0].js; (cs.indexOf('src/lexicon.js')<cs.indexOf('src/tagsync.js') && cs.indexOf('src/tagsync.js')<cs.indexOf('src/engine.js'))?console.log('OK'):process.exit(1)"` — Expected: `OK`.
- [ ] **Step 6: Commit**

```bash
git add src/tagsync.js test/tagsync.test.js manifest.json
git commit -m "feat(tagsync): lire les tags de l'utilisateur (plus de création en dur)"
```

---

### Task 7: Intégration `engine.js` — vocabulaire + 4 comportements

**Files:** Modify `src/engine.js`, `src/api.js`.

**Interfaces:** Consumes `WMC_TAGSYNC`, `WMC_LEXICON`, `WMC_INTEREST`, `cardMeta`, `willingToPay`, `getAuctions`, flags Task 1. Produces `interestVocab(cfg)` (cache mémoire du vocab compilé), `onThemeTags(card, meta)`, jobs `interestAutoTag`, `interestMarketScan`.

- [ ] **Step 1: `api.js` — exposer `user_card_id`** — dans `ownedCards`, remplacer la ligne `const cards = out.map(...)` par :

```js
    const cards = out.map((e) => ({ ...e.card, count: e.count, starred: e.starred, tags: e.tags, userCardId: e.id }));
```

- [ ] **Step 2: Vocabulaire compilé, mis en cache mémoire** — dans `engine.js`, après `cardMeta` (~ligne 138), ajouter :

```js
  // Vocabulaire compilé (tags de l'utilisateur × rimessolides), rafraîchi ~30 min.
  let vocabCache = { at: 0, compiled: [], tagIds: {} };
  async function interestVocab(cfg) {
    if (typeof WMC_TAGSYNC === "undefined" || typeof WMC_LEXICON === "undefined" || typeof WMC_INTEREST === "undefined") {
      return { compiled: [], tagIds: {} };
    }
    if (Date.now() - vocabCache.at < 1_800_000 && vocabCache.compiled.length) return vocabCache;
    const tags = await WMC_TAGSYNC.listTags();
    const tagIds = {};
    const built = [];
    for (const t of tags) {
      tagIds[t.id] = t.name;
      const words = await WMC_LEXICON.buildVocab(t, cfg); // cache-first, fetch rimessolides si besoin
      built.push({ tagId: t.id, words });
    }
    vocabCache = { at: Date.now(), compiled: WMC_INTEREST.compileVocab(built), tagIds };
    return vocabCache;
  }
  const onThemeTags = (card, meta, vocab) =>
    typeof WMC_INTEREST === "undefined" ? [] : WMC_INTEREST.classify(card, meta, vocab.compiled);
```

- [ ] **Step 3: Comportement 2 — bonus + priorité** — remplacer `willingToPay` par une version qui prend un flag on-theme :

```js
  const willingToPay = (card, meta, cfg, onTheme) => {
    const hard = cfg.maxBidWb ?? 30;
    let base = hard;
    if (typeof WMC_VALUE !== "undefined") {
      const v = WMC_VALUE.estimate(card, meta);
      base = v == null ? hard : Math.round(v * (cfg.buyValueRatio ?? 0.6));
    }
    if (onTheme && cfg.interestAutoBid) base += cfg.interestBidBonus ?? 0;
    return Math.min(hard, base);
  };
```

Dans `snipeEndgame`, charger le vocab en tête (`const vocab = cfg.interestAutoBid ? await interestVocab(cfg) : { compiled: [] };`), puis :
- remplacer les 2 appels `willingToPay(a.card, meta, cfg)` / `willingToPay(pick.card, pickMeta, cfg)` par `willingToPay(<card>, <meta>, cfg, onThemeTags(<card>, <meta|null>, vocab).length > 0)` ;
- remplacer le tri `inWindow.sort((x, y) => secondsLeft(x) - secondsLeft(y));` par :

```js
    const themed = (a) => (cfg.interestAutoBid && onThemeTags(a.card, null, vocab).length ? 0 : 1);
    inWindow.sort((x, y) => themed(x) - themed(y) || secondsLeft(x) - secondsLeft(y));
```

- [ ] **Step 4: Comportement 4 — protection anti-vente** — dans `autoSell`, charger `const vocab = cfg.interestProtectSell ? await interestVocab(cfg) : { compiled: [] };` avant le `const candidates = cards.filter(...)`, et ajouter la clause :

```js
        !(cfg.interestProtectSell && onThemeTags(c, null, vocab).length) && // protège le on-theme
```

- [ ] **Step 5: Comportement 3 — auto-étiquetage** — ajouter avant `// ---------- one full cycle ----------` :

```js
  async function interestAutoTag(cfg) {
    if (!cfg.interestAutoTag) return;
    const vocab = await interestVocab(cfg);
    if (!vocab.compiled.length) return;
    const already = await WMC_TAGSYNC.listAssignments();
    const owned = (await WMC_API.ownedCards().catch(() => ({ cards: [] }))).cards || [];
    const pairs = [];
    for (const c of owned) {
      const ucid = c.userCardId;
      if (!ucid) continue;
      const meta = await cardMeta(c);
      for (const tagId of onThemeTags(c, meta, vocab)) {
        if (!already.has(`${ucid}|${tagId}`)) pairs.push({ user_card_id: ucid, tag_id: tagId });
      }
    }
    if (!pairs.length) return;
    const res = await WMC_TAGSYNC.assignTags(pairs, isDry(cfg));
    wmcNotify(isDry(cfg) ? "😈 Étiquetage (dry-run)" : "😈 Cartes étiquetées",
      `${res.count} étiquette(s) ${isDry(cfg) ? "seraient posées" : "posées"}.`);
  }
```

- [ ] **Step 6: Comportement 1 — repérage marché** — ajouter après `interestAutoTag` :

```js
  async function interestMarketScan(cfg) {
    if (!cfg.interestWatch) return;
    const vocab = await interestVocab(cfg);
    if (!vocab.compiled.length) return;
    const hits = (await getAuctions().catch(() => []))
      .filter((a) => a.status === "active" && cfg.targetRarities.includes(a.card?.rarity))
      .filter((a) => onThemeTags(a.card, null, vocab).length);
    if (!hits.length) return;
    const { wmcInterestSeen = {} } = await store.get({ wmcInterestSeen: {} });
    const fresh = hits.filter((a) => !wmcInterestSeen[a.id]);
    if (!fresh.length) return;
    const now = Date.now();
    for (const a of fresh) wmcInterestSeen[a.id] = now;
    for (const k of Object.keys(wmcInterestSeen)) if (now - wmcInterestSeen[k] > 21_600_000) delete wmcInterestSeen[k];
    await store.set({ wmcInterestSeen });
    wmcNotify("😈 Carte à ton goût au marché",
      `${fresh.length} enchère(s) on-theme, ex. ${fresh[0].card?.wikipedia_title} (${fresh[0].card?.rarity}).`);
  }
```

- [ ] **Step 7: Brancher les jobs** — dans `runCycle`, remplacer la liste `jobs` par :

```js
      const jobs = shuffle([
        () => openPacks(cfg), () => autoSell(cfg), () => watchTarget(cfg),
        () => enrichCards(cfg), () => interestAutoTag(cfg), () => interestMarketScan(cfg),
      ]);
```

- [ ] **Step 8: Enrichir aussi la collection** — remplacer `enrichCards` par :

```js
  async function enrichCards(cfg) {
    if (typeof WMC_ENRICH === "undefined" || typeof WMC_DB === "undefined") return;
    const cards = (await getAuctions().catch(() => [])).map((a) => a.card).filter(Boolean);
    await WMC_ENRICH.enrichSeen(cards, cfg.enrichPerCycle ?? 3);
    if (cfg.interestAutoTag || cfg.interestProtectSell) {
      const owned = (await WMC_API.ownedCards().catch(() => ({ cards: [] }))).cards || [];
      await WMC_ENRICH.enrichSeen(owned, cfg.enrichPerCycle ?? 3, { rarities: ["L", "UR", "SR", "R", "PC", "C"] });
    }
  }
```

- [ ] **Step 9: Vérif syntaxe** — Run: `node --check src/engine.js && node --check src/api.js` — Expected: aucune sortie.

- [ ] **Step 10: Vérif live dry-run** — recharger l'extension, `/collection`, panneau : `Automation active` + `Dry-run` + `Auto-étiquetage`. Attendre 1-2 cycles → notif « Étiquetage (dry-run) : N ». Vérifier console sans erreur, et un fetch réseau vers rimessolides depuis le service worker (onglet du SW dans chrome://extensions → Service Worker → Network). Expected: notif dry-run, fetch rimessolides OK, zéro erreur.

- [ ] **Step 11: Commit**

```bash
git add src/engine.js src/api.js
git commit -m "feat(engine): vocab dynamique + 4 comportements interest"
```

---

### Task 8: `dashboard.js` — comptes + vocabulaire éditable

**Files:** Modify `src/dashboard.js`.

**Interfaces:** Consumes `WMC_TAGSYNC.listTags`, `WMC_LEXICON.buildVocab/removeWord`, `WMC_INTEREST.compileVocab/classify`, `WMC_DB.allCardMeta`, `WMC_API.ownedCards`.

- [ ] **Step 1: Contrôles** — dans `CONTROLS`, ajouter :

```js
    { k: "interestWatch", label: "Repérage marché (thèmes)" },
    { k: "interestAutoBid", label: "Auto-bid prioritaire (thèmes)" },
    { k: "interestAutoTag", label: "Auto-étiquetage (thèmes)" },
    { k: "interestProtectSell", label: "Protéger le on-theme (vente)" },
    { k: "interestBidBonus", label: "Bonus mise on-theme (WB)", num: true },
```

- [ ] **Step 2: Calcul comptes + vocab dans `render()`** — après `const cards = owned.cards || [];` :

```js
    let themeSection = "";
    if (typeof WMC_TAGSYNC !== "undefined" && typeof WMC_LEXICON !== "undefined" && typeof WMC_INTEREST !== "undefined") {
      const tags = await WMC_TAGSYNC.listTags().catch(() => []);
      const metaByTitle = {};
      for (const m of await WMC_DB.allCardMeta().catch(() => [])) metaByTitle[m.title] = m;
      const built = [];
      const vocabByTag = {};
      for (const t of tags) {
        const words = await WMC_LEXICON.buildVocab(t, cfg).catch(() => []);
        vocabByTag[t.id] = { name: t.name, color: t.color, words };
        built.push({ tagId: t.id, words });
      }
      const compiled = WMC_INTEREST.compileVocab(built);
      const counts = {};
      for (const c of cards) {
        const meta = metaByTitle[c.wikipedia_title] || null;
        for (const id of WMC_INTEREST.classify(c, meta, compiled)) counts[id] = (counts[id] || 0) + 1;
      }
      themeSection = tags
        .map((t) => {
          const v = vocabByTag[t.id] || { words: [] };
          const chips = v.words.slice(0, 40)
            .map((w) => `<span class="kw" data-tag="${esc(t.name)}" data-w="${esc(w)}" title="Cliquer pour retirer">${esc(w)}×</span>`)
            .join(" ");
          return `<tr><td><span class="pill" style="background:${t.color}22;color:${t.color}">${esc(t.name)}</span></td><td class="r">${counts[t.id] || 0}</td></tr>
                  <tr><td colspan="2" class="kws">${chips || '<span class="muted">vocabulaire en cours…</span>'}</td></tr>`;
        })
        .join("");
    }
```

- [ ] **Step 3: CSS des puces** — dans la chaîne `css`, ajouter :

```css
    #wmc-panel .kws{padding:2px 0 8px}
    #wmc-panel .kw{display:inline-block;margin:1px;padding:0 5px;border-radius:6px;background:#1e293b;color:#94a3b8;font-size:11px;cursor:pointer}
    #wmc-panel .kw:hover{background:#7f1d1d;color:#fecaca}
```

- [ ] **Step 4: Afficher la section** — insérer avant `<h3>Âmes à corrompre (wishlist)</h3>` :

```js
      <h3>Tes thèmes</h3>
      <table>${themeSection || `<tr><td class="muted" colspan="2">Aucune étiquette (ou session absente).</td></tr>`}</table>
      <p class="muted">Comptes = cartes possédées qui matchent. Clique un mot pour le retirer du vocabulaire.</p>
```

- [ ] **Step 5: Câbler la suppression de mot** — dans `wireControls(p)`, ajouter :

```js
    p.querySelectorAll(".kw").forEach((chip) =>
      chip.addEventListener("click", async () => {
        await WMC_LEXICON.removeWord(chip.dataset.tag, chip.dataset.w);
        chip.remove();
        wmcToast("Vocabulaire", `« ${chip.dataset.w} » retiré de « ${chip.dataset.tag} ».`);
      })
    );
```

- [ ] **Step 6: Vérif syntaxe** — Run: `node --check src/dashboard.js` — Expected: aucune sortie.
- [ ] **Step 7: Vérif live** — recharger, ouvrir le panneau : section « Tes thèmes » avec comptes + puces de mots ; cliquer un mot le retire (persistant après re-render). Expected: OK.
- [ ] **Step 8: Commit**

```bash
git add src/dashboard.js && git commit -m "feat(dashboard): comptes par thème + vocabulaire éditable"
```

---

### Task 9: Premier run + validation récall

- [ ] **Step 1: Tests** — Run: `node --test test/` — Expected: PASS (interest, enrich, lexicon, tagsync).
- [ ] **Step 2: Dry-run** — panneau : `Automation active` + `Dry-run` + `Auto-étiquetage` ON ; monter `enrichPerCycle` (~10) le temps du backfill. Laisser tourner ; vérifier la section « Tes thèmes » (comptes se remplissent), et que `Histoire de France` inclut **Mathilde de Flandre** (via catégorie « Duchesse de Normandie »).
- [ ] **Step 3: Réel** — renseigner le pseudo, décocher `Dry-run` ; laisser un cycle poser les étiquettes ; vérifier sur `/collection`. Remettre `enrichPerCycle` à 3.
- [ ] **Step 4: Affinage** — retirer les mots fautifs via les puces (ou compléter `STOPWORDS`), relancer `node --test test/`, puis `git commit -m "fix(interest): affinage vocabulaire/stoplist"`.

---

## Self-Review

**Couverture du spec :** §4.1 `WMC_INTEREST`→Task 2 ; §4.2 `lexicon`→Task 5 ; §4.3 background fetch→Task 5 s5 ; §4.4 `tagsync.listTags`→Task 6 ; §4.5 db store→Task 4 ; §4.6 enrich→Task 3 ; §4.7 engine (4 comportements)→Task 7 ; §4.8 dashboard éditable→Task 8 ; §4.9 manifest (perm+ordre)→Tasks 2/5/6 ; §2 premier run→Task 9 ; §5 Prudent→Task 2 (matchable/STOPWORDS) + Task 5 (applyFilter) ; §6 erreurs→dégradations gracieuses dans lexicon/tagsync/engine (retours vides). ✅

**Placeholders :** aucun ; code complet partout.

**Cohérence des types :** `{tagId, words}` produit par Task 7 `interestVocab`, consommé par `WMC_INTEREST.compileVocab` (Task 2) ; `compiled` passé à `classify` ; `userCardId` ajouté (api.js) et lu (engine `interestAutoTag`) ; `{user_card_id, tag_id}` cohérent tagsync/engine ; `buildVocab(tag, cfg)` signature identique engine/dashboard ; `removeWord(name, word)` dashboard↔lexicon ; store `interest_vocab` keyPath `name` cohérent db/lexicon.
