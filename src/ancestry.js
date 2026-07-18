// Ascendance de graphe Wikipédia — la couche I/O du classifieur S13.
// Résout les racines de catégorie de chaque étiquette et alimente le cache local
// des parents de catégories (lots de 50, API MediaWiki avec origin=* : CORS
// anonyme OK depuis le content-script, comme enrich.js). Aucun service worker.
// Graphe frwiki uniquement : les cartes non-francophones ne classifient que via le fast-path titre.

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
    let row = await WMC_DB.getRoots(tagName).catch(() => null);
    const age = row ? Date.now() - (row.fetchedAt || 0) : Infinity;
    // Résolution vide persistée aussi (retry quotidien), sinon TTL long.
    const ttl = ((row && (row.resolved || []).length ? (cfg && cfg.rootsTtlDays) || 90 : 1)) * 24 * 3600 * 1000;
    if (age > ttl) {
      const resolved = await resolveRoots(tagName);
      row = { name: tagName, resolved, added: (row && row.added) || [], removed: (row && row.removed) || [], fetchedAt: Date.now() };
      await WMC_DB.putRoots(row);
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
      // Ne persister que ce que l'API a confirmé (présent dans la réponse) : un lot
      // échoué reste non caché et sera retenté — jamais de faux "sans parents".
      for (const n of chunk) if (n in acc) await WMC_DB.putCatParents({ name: n, parents: [...new Set(acc[n])] });
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
