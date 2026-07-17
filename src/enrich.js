// Desirability enrichment — fetches structural Wikipedia signals per card title
// and caches them (card_meta) so value.js can score desirability synchronously
// during a bid. Content-script only: needs WMC_DB (cache) + network. No AI —
// every signal is deterministic (interwiki count, backlink count, pageview
// steadiness, geek category). The MediaWiki + Pageviews APIs send permissive
// CORS headers (origin=*), so a page-context fetch works without host perms.

const WMC_ENRICH = (() => {
  const TTL = 30 * 24 * 3600 * 1000; // re-fetch a title at most monthly
  // Geek categories (French Wikipedia). Kept broad — it's only a light bonus in
  // the score; the structural signals (langs/backlinks/steadiness) do the work.
  const GEEK =
    /jeu vid[ée]o|jeux vid[ée]o|manga|anim[ée]|s[ée]rie t[ée]l[ée]|dessin anim[ée]|bande dessin[ée]e|comics|super-h[ée]ros|science-fiction|fantasy|personnage de fiction|jeu de r[ôo]le|jeu de soci[ée]t[ée]|nintendo|playstation|pok[ée]mon|otaku|univers de|catch|cosplay/i;

  const cleanCategoryTitles = (cats) =>
    (cats || [])
      .map((c) => (c && c.title ? c.title.replace(/^(Cat[ée]gorie|Category)\s*:\s*/i, "").trim() : ""))
      .filter(Boolean);

  const median = (a) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  };

  // Last-12-months window for the pageviews API, as YYYYMM0100 strings.
  const pvWindow = () => {
    const now = new Date();
    const fmt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}0100`;
    const start = new Date(now);
    start.setFullYear(now.getFullYear() - 1);
    return { start: fmt(start), end: fmt(now) };
  };

  // Structural signals for one Wikipedia title (its own language wiki). Returns
  // null on a missing page or a hard API failure; pageviews are best-effort.
  async function fetchSignals(title, lang) {
    const code = (lang || "fr").toLowerCase();
    const host = `https://${code}.wikipedia.org`;
    const enc = encodeURIComponent(title);
    let langCount = 0;
    let backlinks = 0;
    let geekCat = false;
    let categories = [];
    try {
      const api = `${host}/w/api.php?action=query&format=json&origin=*&prop=langlinks%7Clinkshere%7Ccategories&lllimit=500&lhlimit=500&lhnamespace=0&cllimit=500&titles=${enc}`;
      const r = await fetch(api).then((x) => x.json());
      const p = Object.values(r?.query?.pages || {})[0] || {};
      if (p.missing !== undefined) return null; // no such page
      langCount = (p.langlinks || []).length;
      backlinks = (p.linkshere || []).length;
      categories = cleanCategoryTitles(p.categories);
      geekCat = categories.some((c) => GEEK.test(c));
    } catch (_) {
      return null;
    }
    let spikeRatio = null;
    let pvMedian = 0;
    try {
      const { start, end } = pvWindow();
      const titleU = encodeURIComponent(title.replace(/ /g, "_"));
      const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${code}.wikipedia/all-access/all-agents/${titleU}/monthly/${start}/${end}`;
      const d = await fetch(url).then((x) => x.json());
      const views = (d.items || []).map((i) => i.views).filter((n) => Number.isFinite(n));
      if (views.length) {
        pvMedian = median(views);
        const max = Math.max(...views);
        spikeRatio = pvMedian ? +(max / pvMedian).toFixed(1) : null;
      }
    } catch (_) {
      /* pageviews are optional — score still works without the spike signal */
    }
    return { langCount, backlinks, geekCat, spikeRatio, pvMedian, categories };
  }

  // Ensure a batch of UR/L cards has fresh cached signals. Rate-limited: fetches
  // at most `max` uncached/stale titles per call, spaced out, to stay gentle on
  // the Wikipedia API. Cheap rarities are skipped (their value is a flat floor).
  async function enrichSeen(cards, max, opts) {
    if (typeof WMC_DB === "undefined") return; // no cache in this context (service worker)
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
    let done = 0;
    for (const { title, lang } of todo) {
      if (done >= (max ?? 3)) break;
      const sig = await fetchSignals(title, lang);
      if (sig) {
        const score = typeof WMC_VALUE !== "undefined" ? WMC_VALUE.desirabilityScore(sig) : null;
        await WMC_DB.putCardMeta({ title, ...sig, score });
      }
      done++;
      await new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 600)));
    }
  }

  return { fetchSignals, enrichSeen, GEEK, cleanCategoryTitles };
})();

if (typeof module !== "undefined" && module.exports) module.exports = WMC_ENRICH;
