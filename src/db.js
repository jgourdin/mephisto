// Local IndexedDB store — the intelligence layer. Everything the companion
// observes (auction prices, pulls, WB ledger, learned endpoints) lands here
// so features can reason from history instead of fixed thresholds.
//
// Runs in the content-script isolated world: this DB is the extension's own,
// separate from the game's IndexedDB.

const WMC_DB = (() => {
  const NAME = "wmc";
  const VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        // One auction observation per (auctionId, seenAt): lets us rebuild
        // price history and settle-price medians per card and per rarity.
        if (!db.objectStoreNames.contains("price_obs")) {
          const s = db.createObjectStore("price_obs", { keyPath: "key" });
          s.createIndex("cardId", "cardId");
          s.createIndex("rarity", "rarity");
          s.createIndex("auctionId", "auctionId");
        }
        // Pack pulls: one row per card obtained, for drop-rate stats.
        if (!db.objectStoreNames.contains("pulls")) {
          db.createObjectStore("pulls", { keyPath: "key", autoIncrement: true });
        }
        // WB ledger snapshots (dedup by ledger row id).
        if (!db.objectStoreNames.contains("wb_ledger")) {
          db.createObjectStore("wb_ledger", { keyPath: "id" });
        }
        // Endpoints learned by the network sniffer (POST routes + payload shape).
        if (!db.objectStoreNames.contains("endpoints")) {
          db.createObjectStore("endpoints", { keyPath: "name" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => resolve(out?.result ?? out);
      t.onerror = () => reject(t.error);
    });
  }

  async function getAll(store, index, query) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const s = db.transaction(store, "readonly").objectStore(store);
      const src = index ? s.index(index) : s;
      const req = src.getAll(query);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  const median = (nums) => {
    if (!nums.length) return null;
    const a = [...nums].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };

  return {
    // Record what an auction looked like at scan time. `key` dedups by
    // auction + effective bid so we don't store identical rows every tick.
    async recordAuction(a, nowMs) {
      const bid = a.current_bid ?? a.base_amount;
      await tx("price_obs", "readwrite", (s) =>
        s.put({
          key: `${a.id}:${bid}`,
          auctionId: a.id,
          cardId: a.card?.id ?? a.card_id,
          rarity: a.card?.rarity ?? a.snapshot_rarity,
          bid,
          status: a.status,
          finalPrice: a.final_price ?? null,
          endAt: a.end_at,
          seenAt: nowMs,
        })
      );
    },

    async recordPull(card, nowMs) {
      await tx("pulls", "readwrite", (s) =>
        s.add({ cardId: card.id, rarity: card.rarity, title: card.wikipedia_title, at: nowMs })
      );
    },

    async recordLedger(rows) {
      await tx("wb_ledger", "readwrite", (s) => rows.forEach((r) => s.put(r)));
    },

    async saveEndpoint(name, info) {
      await tx("endpoints", "readwrite", (s) => s.put({ name, ...info }));
    },
    async getEndpoint(name) {
      const db = await open();
      return new Promise((resolve) => {
        const req = db.transaction("endpoints", "readonly").objectStore("endpoints").get(name);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    },

    // Median observed bid for a rarity (proxy for "fair price").
    async medianPriceByRarity(rarity) {
      const rows = await getAll("price_obs", "rarity", rarity);
      return median(rows.map((r) => r.bid).filter((n) => Number.isFinite(n)));
    },
    async priceHistory(cardId) {
      return getAll("price_obs", "cardId", cardId);
    },
    async pullStats() {
      const rows = await getAll("pulls");
      const byRarity = {};
      for (const r of rows) byRarity[r.rarity] = (byRarity[r.rarity] || 0) + 1;
      return { total: rows.length, byRarity };
    },
    async ledger() {
      return getAll("wb_ledger");
    },
    median,
  };
})();
