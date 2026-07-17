// Card value estimator — deterministic, derived from the market study
// (see docs/market-value-analysis.md). No AI: the price drivers are numeric and
// live on the card object, so a formula beats a guess.
//
//   value ≈ rarityFloor
//           × popFactor(pageviews)   // #1 continuous driver (corr 0.58)
//           × qFactor(q_score)       // corr 0.42
//           × statFactor(atk+def)    // UR/L only — battle utility
//           × themeMultiplier        // geek/FR collectibility, beyond raw popularity
//
// Used by the sniper (bid up to value × ratio) and auto-sell (price near value).

const WMC_VALUE = (() => {
  // Median clearing price per rarity (real market, botnet excluded).
  const RARITY_FLOOR = { L: 1000, UR: 300, SR: 13, R: 13, C: 13, PC: 10 };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  // Collectibility of the WikiMasters audience (geek + French): some themes are
  // over-collected relative to their raw popularity, others under. HYPOTHESIS —
  // seeded from domain + observed price-per-view (video games ~340 WB/1k views,
  // sport ~2); tune / auto-calibrate as clearing-price data accumulates.
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

  // Estimated WB value of a card from its attributes.
  function estimate(card) {
    if (!card) return null;
    const floor = RARITY_FLOOR[card.rarity] ?? 10;
    // Below UR everything is a ~10-13 commodity — the floor is the whole story
    // (stats/pageviews don't move the price there), only the theme nudges it.
    if (card.rarity !== "UR" && card.rarity !== "L") return Math.round(floor * themeMultiplier(card));
    const pop = clamp((card.pageviews || 0) / 10000, 0.3, 5);
    const q = clamp((card.q_score || 50) / 60, 0.7, 1.3);
    const stat = clamp(((card.atk || 0) + (card.def || 0)) / 13000, 0.7, 1.5);
    return Math.round(floor * pop * q * stat * themeMultiplier(card));
  }

  return { estimate, themeMultiplier, RARITY_FLOOR };
})();
