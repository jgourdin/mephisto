// Local IndexedDB store — the intelligence layer. Everything the companion
// observes (auction prices, pulls, WB ledger, learned endpoints) lands here
// so features can reason from history instead of fixed thresholds.
//
// Runs in the content-script isolated world: this DB is the extension's own,
// separate from the game's IndexedDB.

const WMC_DB = (() => {
  const NAME = "wmc";
  const VERSION = 7;
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
        // Target-watch: a monitored player's market moves (one row per bid /
        // per listing, key-deduped), indexed by username for export.
        if (!db.objectStoreNames.contains("target_obs")) {
          const s = db.createObjectStore("target_obs", { keyPath: "key" });
          s.createIndex("user", "user");
        }
        // Sell A/B test: one row per listing we create, tagged with the strategy
        // used, and its settled outcome (sold + final price) reconciled later.
        if (!db.objectStoreNames.contains("sell_ab")) {
          const s = db.createObjectStore("sell_ab", { keyPath: "auctionId" });
          s.createIndex("strategy", "strategy");
        }
        // Cached desirability signals per Wikipedia title (langlinks, backlinks,
        // pageview-spike ratio, geek category) + derived score. Fetched from the
        // Wikipedia API, cached here so value.js can read it synchronously.
        if (!db.objectStoreNames.contains("card_meta")) {
          db.createObjectStore("card_meta", { keyPath: "title" });
        }
        // v6: l'ascendance de graphe remplace l'ancien vocabulaire textuel.
        if (db.objectStoreNames.contains("interest_vocab")) db.deleteObjectStore("interest_vocab");
        // Parents (topicaux) de chaque catégorie Wikipédia rencontrée — le graphe local.
        if (!db.objectStoreNames.contains("cat_parents")) {
          db.createObjectStore("cat_parents", { keyPath: "name" });
        }
        // Racines de catégorie par étiquette: résolues + ajouts/retraits de l'utilisateur.
        if (!db.objectStoreNames.contains("interest_roots")) {
          db.createObjectStore("interest_roots", { keyPath: "name" });
        }
        // v7: journal des actions de l'automatisation (affiché dans le dashboard).
        if (!db.objectStoreNames.contains("action_log")) {
          db.createObjectStore("action_log", { keyPath: "id", autoIncrement: true });
        }
        // Real clearing prices of settled auctions (title + rarity + final), so we
        // can anchor value on what the market actually pays, not on pageviews.
        if (!db.objectStoreNames.contains("sale_obs")) {
          const s = db.createObjectStore("sale_obs", { keyPath: "key" });
          s.createIndex("rarity", "rarity");
          s.createIndex("title", "title");
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

    // Target-watch: dedup-store a monitored player's observed market actions,
    // then export/count them by username for offline strategy analysis.
    async recordTargetObs(rows) {
      if (!rows?.length) return;
      await tx("target_obs", "readwrite", (s) => rows.forEach((r) => s.put(r)));
    },
    async exportTarget(user) {
      const rows = await getAll("target_obs", user ? "user" : undefined, user || undefined).catch(() => []);
      return rows.sort((a, b) => (a.at || 0) - (b.at || 0));
    },
    async targetCount(user) {
      return (await this.exportTarget(user)).length;
    },

    // Sell A/B test: tag a new listing with its strategy; reconcile outcomes from
    // our settled listings (mine.history); summarise which strategy performs best.
    async recordSellAB(row) {
      if (!row?.auctionId) return;
      await tx("sell_ab", "readwrite", (s) => s.put({ sold: null, finalPrice: null, ...row }));
    },
    async reconcileSellAB(history) {
      if (!history?.length) return;
      const byId = new Map(history.map((a) => [a.id, a]));
      await tx("sell_ab", "readwrite", (s) => {
        const req = s.getAll();
        req.onsuccess = () => {
          for (const row of req.result) {
            if (row.sold != null) continue; // already settled
            const h = byId.get(row.auctionId);
            if (!h) continue;
            const sold = !!(h.winner_id && h.winner_id !== h.seller_id && h.final_price != null);
            s.put({ ...row, sold, finalPrice: sold ? h.final_price : 0, settledAt: Date.now() });
          }
        };
      });
    },
    async sellAbStats() {
      const rows = await getAll("sell_ab").catch(() => []);
      const g = {};
      for (const r of rows) {
        const s = (g[r.strategy] = g[r.strategy] || { listed: 0, settled: 0, sold: 0, wb: 0 });
        s.listed++;
        if (r.sold != null) {
          s.settled++;
          if (r.sold) {
            s.sold++;
            s.wb += r.finalPrice || 0;
          }
        }
      }
      const out = {};
      for (const [k, v] of Object.entries(g))
        out[k] = {
          listed: v.listed,
          settled: v.settled,
          sold: v.sold,
          sellThroughPct: v.settled ? Math.round((100 * v.sold) / v.settled) : null,
          wbPerListing: v.settled ? Math.round(v.wb / v.settled) : null,
          avgSalePrice: v.sold ? Math.round(v.wb / v.sold) : null,
        };
      return out;
    },

    // Cached desirability signals per Wikipedia title.
    async getCardMeta(title) {
      if (!title) return null;
      const db = await open();
      return new Promise((resolve) => {
        const req = db.transaction("card_meta", "readonly").objectStore("card_meta").get(title);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    },
    async putCardMeta(row) {
      if (!row?.title) return;
      await tx("card_meta", "readwrite", (s) => s.put({ ...row, fetchedAt: row.fetchedAt ?? Date.now() }));
    },
    async allCardMeta() {
      return getAll("card_meta").catch(() => []);
    },

    async getCatParents(name) {
      if (!name) return null;
      const db = await open();
      return new Promise((resolve) => {
        const req = db.transaction("cat_parents", "readonly").objectStore("cat_parents").get(name);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    },
    async putCatParents(row) {
      if (!row || !row.name) return;
      await tx("cat_parents", "readwrite", (s) => s.put({ fetchedAt: Date.now(), parents: [], ...row }));
    },
    async allCatParents() {
      return getAll("cat_parents").catch(() => []);
    },
    async getRoots(name) {
      if (!name) return null;
      const db = await open();
      return new Promise((resolve) => {
        const req = db.transaction("interest_roots", "readonly").objectStore("interest_roots").get(name);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    },
    async putRoots(row) {
      if (!row || !row.name) return;
      await tx("interest_roots", "readwrite", (s) => s.put({ fetchedAt: Date.now(), resolved: [], added: [], removed: [], ...row }));
    },

    // Journal des actions de l'automatisation (auto-open, mises, ventes,
    // étiquetage, protections…) — la matière de la section « Journal de l'IA ».
    async recordAction(row) {
      if (!row || !row.type) return;
      await tx("action_log", "readwrite", (s) => s.add({ at: Date.now(), ...row }));
      // Journal borné : au-delà de ~600 lignes, purge les plus anciennes.
      const db = await open();
      const count = await new Promise((res) => {
        const rq = db.transaction("action_log", "readonly").objectStore("action_log").count();
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => res(0);
      });
      if (count > 600)
        await tx("action_log", "readwrite", (s) => {
          let n = count - 500;
          s.openCursor().onsuccess = (e) => {
            const c = e.target.result;
            if (c && n-- > 0) { c.delete(); c.continue(); }
          };
        });
    },
    async recentActions(limit = 25) {
      const rows = await getAll("action_log").catch(() => []);
      return rows.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, limit);
    },

    // Real clearing prices of settled-sold auctions, for market-anchored value.
    async recordSale(rows) {
      if (!rows?.length) return;
      await tx("sale_obs", "readwrite", (s) => rows.forEach((r) => r?.key && s.put(r)));
    },
    async medianSaleByRarity(rarity) {
      const rows = await getAll("sale_obs", "rarity", rarity).catch(() => []);
      return median(rows.map((r) => r.final).filter((n) => Number.isFinite(n)));
    },
    async salesByTitle(title) {
      return getAll("sale_obs", "title", title).catch(() => []);
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
