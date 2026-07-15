// Pure analysis helpers (no side effects). Consumed by the dashboard overlay
// and the guild module. Kept framework-free so they run in the content script.

const WMC_ANALYSIS = {
  // Battle: HP = sum of DEF, one card attacks per turn, damage = ATK ×
  // (wrong answers / total). Best deck of 3 depends on objective:
  //   "tank"    -> maximize starting HP (sum DEF)
  //   "aggro"   -> maximize total ATK
  //   "balanced"-> maximize DEF + ATK
  bestDeck(cards, objective = "balanced") {
    const score = (c) =>
      objective === "tank" ? c.def : objective === "aggro" ? c.atk : c.def + c.atk;
    return [...cards].sort((a, b) => score(b) - score(a)).slice(0, 3);
  },

  // Best attackers: high ATK on obscure articles (opponent likely fails the
  // quiz -> more wrong answers -> more damage). Obscurity ~ 1 / pageviews.
  attackRanking(cards, limit = 10) {
    return [...cards]
      .map((c) => ({ ...c, threat: Math.round(c.atk / Math.log10(Math.max(10, c.pageviews || 10))) }))
      .sort((a, b) => b.threat - a.threat)
      .slice(0, limit);
  },

  // Duplicate sell candidates — needs a per-card copy count. The owned-cards
  // API is deduplicated, so this only works if a count field is present
  // (copies/count/quantity/owned_count). Returns [] otherwise.
  duplicateSuggestions(cards) {
    const countOf = (c) => c.copies ?? c.count ?? c.quantity ?? c.owned_count ?? null;
    if (!cards.some((c) => countOf(c) != null)) return { available: false, cards: [] };
    return {
      available: true,
      cards: cards
        .filter((c) => (countOf(c) || 1) > 1)
        .map((c) => ({ ...c, extra: countOf(c) - 1 }))
        .sort((a, b) => b.extra - a.extra),
    };
  },

  // Guild wishlist: entries I can fulfil right now. The API already tells us
  // can_donate + recipient_received_today, so we just filter + rank by the
  // IP points the rarity is worth.
  IP_POINTS: { C: 100, PC: 200, R: 300, SR: 500, UR: 1000, L: 2000 },
  wishlistMatches(guildHome) {
    const list = guildHome?.wishlist || [];
    return list
      .filter((w) => !w.is_self && w.can_donate && !w.recipient_received_today)
      .map((w) => ({
        entryId: w.id,
        cardId: w.card?.id,
        title: w.card?.wikipedia_title,
        rarity: w.card?.rarity,
        to: w.username,
        points: WMC_ANALYSIS.IP_POINTS[w.card?.rarity] || 0,
        copyIds: w.owned_copy_ids || [],
      }))
      .sort((a, b) => b.points - a.points);
  },
};
