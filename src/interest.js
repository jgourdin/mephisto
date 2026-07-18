// Matching d'intérêts — PUR, sans IA, sans thème en dur. Une carte matche un tag
// si une de ses catégories Wikipédia descend (ascendance de graphe, ancestry.js)
// d'une racine résolue pour ce tag, ou si son titre contient un mot du nom du tag.

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
      for (const tok of p.split(/[^a-z0-9]+/)) if (matchable(tok, 4)) out.add(tok);
    }
    return [...out];
  }

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

  return { normalize, STOPWORDS, matchable, nameWords, META_RE, BIO_RE, topicalCat, walkAncestry, missingParents, titleTags };
})();

if (typeof module !== "undefined" && module.exports) module.exports = WMC_INTEREST;
