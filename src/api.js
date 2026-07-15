// Thin wrappers over the game's same-origin API. Auth = the page's existing
// session cookies; we send nothing extra. All contracts verified live on
// 2026-07-15 (see docs/recon.md).

const WMC_API = {
  async get(path) {
    const res = await fetch(path, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
  },

  // Reads
  balance: () => WMC_API.get("/api/wikibidous"), // { balance, ledger:[...] }
  ownedCardIds: () => WMC_API.get("/api/owned-card-ids"), // { cardIds:[...] }
  collectionStats: () => WMC_API.get("/api/my-collection/stats?sort=rarity"), // { total, rarityCounts, tagOptions }

  // My collection. NOTE: /api/cards?owned=true is a trap — the owned flag is
  // ignored and it returns the 2.7M global catalogue. The real endpoint is
  // /api/my-collection, whose entries are { card:{...}, count, tags, starred }.
  // We page through it and flatten so consumers get {...card, count, ...}.
  async ownedCards(sort = "rarity") {
    const out = [];
    for (let page = 0; page < 100; page++) {
      const { collection = [] } = await WMC_API.get(
        `/api/my-collection?sort=${sort}&page=${page}&stats=0`
      );
      out.push(...collection);
      if (collection.length < 50) break;
    }
    const cards = out.map((e) => ({ ...e.card, count: e.count, starred: e.starred, tags: e.tags }));
    return { cards };
  },
  auctions: (sort = "ending_soon", page = 1, limit = 50) =>
    WMC_API.get(`/api/marketplace?page=${page}&limit=${limit}&sort=${sort}`), // { auctions:[...] }
  myMarket: () => WMC_API.get("/api/marketplace/mine"), // { selling:[], bidding:[] }
  guildHome: () => WMC_API.get("/api/guilds/home"), // { guild, wishlist:[...], leaderboard }
  contest: () => WMC_API.get("/api/contest"),

  // Actions (verified)
  bid: (auctionId, amount) => WMC_API.post(`/api/marketplace/${auctionId}/bid`, { amount }),
};
