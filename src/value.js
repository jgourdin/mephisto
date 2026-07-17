// Card value estimator — deterministic, no AI.
//
// UR/L value is driven by DESIRABILITY to the (geek + French) WikiMasters
// audience, NOT raw Wikipedia pageviews — pageviews proved a poor proxy: an
// obscure 26k-view UR (a TV doctor, news-driven traffic) cleared at 10 WB while
// a 9k-view French rap icon reached ~600. We approximate desirability from
// structural Wikipedia signals cached by enrich.js:
//   - interwiki breadth (langCount)  → global fame
//   - backlink count (backlinks)     → French-wiki embeddedness / "linked from
//                                       famous pages" (catches FR cult status)
//   - pageview steadiness (spikeRatio, low = good) → durable interest vs a spike
//   - geek category                  → light bonus
// SR and below stay flat ~13 WB commodities (stats/pageviews don't move them).
//
// Used by the sniper (bid up to value × ratio) and auto-sell (floor near value).

const WMC_VALUE = (() => {
  const RARITY_FLOOR = { L: 1000, UR: 300, SR: 13, R: 13, C: 13, PC: 10 };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  // Theme collectibility — only nudges SR/commons (a manga SR beats a stub SR).
  const THEME_MULT = [
    [/jeu vid[ée]o|jeux vid[ée]o|console|nintendo|playstation|gaming|esport|speedrun/i, 1.5],
    [/manga|anim[ée]|shonen|seinen|otaku|studio ghibli/i, 1.5],
    [/science-fiction|fantasy|super-h[ée]ros|marvel|\bdc\b|star wars|star trek|comics|dragon|jeu de r[ôo]le/i, 1.3],
    [/chanteu|musicien|rappeur|compositeur|\balbum\b|acteur|actrice|r[ée]alisateur|\bfilm\b|s[ée]rie|cin[ée]ma/i, 1.1],
    [/football|rugby|sportif|athl[èe]te|olympique|tennis|basket|\bufc\b|boxeur|cycliste|club de/i, 0.8],
  ];
  const themeMultiplier = (card) => {
    const s = ((card?.category || "") + " " + (card?.wikipedia_title || "")).toLowerCase();
    for (const [re, m] of THEME_MULT) if (re.test(s)) return m;
    return 1;
  };

  // Desirability score 0..6 from cached Wikipedia signals (enrich.js). Tuned on
  // real clearing prices: Jimmy Mohamed 0→10, Ligue CAF 0→12, Omar Marmoush 3→46,
  // Kool Shen / The Weeknd 5→450-600. Returns null if the card isn't enriched yet.
  function desirabilityScore(meta) {
    if (!meta) return null;
    let s = 0;
    const lang = meta.langCount || 0;
    s += lang >= 41 ? 3 : lang >= 11 ? 2 : lang >= 1 ? 1 : 0;
    const bl = meta.backlinks || 0;
    s += bl >= 150 ? 2 : bl >= 30 ? 1 : 0;
    const spike = meta.spikeRatio;
    if (spike != null) {
      if (spike < 1.5) s += 1; // steady interest — durable, cult
      else if (spike > 3) s -= 1; // news spike — flash traffic, not collector demand
    }
    if (meta.geekCat) s += 1;
    return clamp(s, 0, 6);
  }

  // WB value per desirability score, for a UR (index 0..6). Anchored on observed
  // clearing prices; the jump at 4 reflects the bimodal market (obscure ~10-60,
  // recognizable ~150-600).
  const UR_BY_SCORE = [12, 20, 35, 60, 150, 350, 600];
  const UR_CONSERVATIVE = 20; // un-enriched UR: assume low so we never overpay before we know it

  // Estimated WB value. `meta` = cached desirability signals (or null/undefined).
  function estimate(card, meta) {
    if (!card) return null;
    if (card.rarity !== "UR" && card.rarity !== "L") {
      const floor = RARITY_FLOOR[card.rarity] ?? 10;
      return Math.round(floor * themeMultiplier(card));
    }
    const score = desirabilityScore(meta);
    const base = score == null ? UR_CONSERVATIVE : UR_BY_SCORE[score];
    // Legendaries clear far higher, but we never buy them (hard ceiling) nor
    // auto-sell them — the multiplier is only for completeness.
    const rarityMult = card.rarity === "L" ? 3 : 1;
    return Math.round(base * rarityMult);
  }

  return { estimate, desirabilityScore, themeMultiplier, RARITY_FLOOR, UR_BY_SCORE };
})();
