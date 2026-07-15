// Thin wrappers over the game's API. Auth = the WikiMasters session cookies.
// Works in TWO contexts:
//   - content script / WebView page: relative paths resolve to the game origin;
//   - service worker (no page origin): we prefix the absolute origin and send
//     credentials, so the extension's host permission attaches the cookies.
// All contracts verified live on 2026-07-15 (see docs/recon.md).

const WMC_ORIGIN = "https://www.wiki-masters.com";
// In a page already on the game, use relative (same-origin). Elsewhere (SW),
// use the absolute origin.
const WMC_BASE =
  typeof location !== "undefined" && /wiki-masters\.com$/.test(location.hostname) ? "" : WMC_ORIGIN;

const WMC_API = {
  async get(path) {
    const res = await fetch(WMC_BASE + path, {
      headers: { accept: "application/json" },
      credentials: "include",
    });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(WMC_BASE + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
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

  // Actions (verified live)
  bid: (auctionId, amount) => WMC_API.post(`/api/marketplace/${auctionId}/bid`, { amount }),
  openPack: () => WMC_API.post("/api/packs/open", {}), // -> { cards:[5], packs_remaining } | 403 { next_regen_at }
  listCard: (cardId, baseAmount, durationMinutes) =>
    WMC_API.post("/api/marketplace", { card_id: cardId, base_amount: baseAmount, duration_minutes: durationMinutes }),
};
