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
    "val", "hip", "hop",
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
