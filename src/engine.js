// Automation engine — SHARED by the service worker (desktop, runs even with
// the tab closed) and the Android WebView in-page driver. Fully API-driven
// (WMC_API), so it is page-independent: no need to be on /pulls or
// /marketplace, and no page-switching. State persists in chrome.storage.
//
// The slow cycle runs two background jobs: open packs and auto-sell (flip owned
// cards higher). Bidding is a separate endgame sniper on a fast timer (page
// driver only). All bounded by the guardrails in config.js.

const WMC_ENGINE = (() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const today = () => new Date().toISOString().slice(0, 10);
  const store = {
    get: (defaults) => new Promise((res) => chrome.storage.local.get(defaults, res)),
    set: (obj) => new Promise((res) => chrome.storage.local.set(obj, res)),
  };

  // Anti-hammering: never run two cycles at once (a cycle can outlast the
  // scan interval), and back off hard on HTTP 429 (rate limit) — over-calling
  // the API gets us AND the game's own requests throttled, which blanks pages.
  let running = false;
  let backoffUntil = 0;
  const backoff = (ms) => {
    backoffUntil = Date.now() + ms;
  };

  // Human-like randomness helpers — irregular timing, order and choices so the
  // activity doesn't look like clockwork.
  const rnd = (a, b) => a + Math.random() * (b - a);
  const chance = (p) => Math.random() < p;
  const shuffle = (arr) => arr.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
  async function jitter(cfg) {
    const [a, b] = cfg.actionJitterMs || [1500, 6000];
    await sleep(a + Math.random() * (b - a));
  }

  // Shared, short-lived auctions snapshot so the slow cycle and the fast sniper
  // loop don't each hammer the marketplace endpoint (429 → the game's own listing
  // fetch gets throttled and blanks the page). Also records price history for the
  // dashboard on every fetch.
  let auctionsCache = { at: 0, list: [] };
  async function getAuctions(fresh = false) {
    if (!fresh && Date.now() - auctionsCache.at < 5_000) return auctionsCache.list;
    const { auctions = [] } = await WMC_API.auctions("ending_soon", 1, 50).catch(() => ({}));
    auctionsCache = { at: Date.now(), list: auctions };
    if (typeof WMC_DB !== "undefined") {
      const now = Date.now();
      for (const a of auctions) WMC_DB.recordAuction(a, now); // price history for the dashboard
    }
    return auctions;
  }
  const invalidateAuctions = () => {
    auctionsCache.at = 0;
  };

  // Daily spend guardrail by balance delta: (day-start balance − current balance).
  // We anchor the balance the first time we see a new day and compare against it.
  // This is robust and proxy-safe: the ledger endpoint only returns a sliding
  // window of recent entries (older ones scroll off, so summing it under-counts),
  // whereas the live balance already nets escrows, refunds and wins. It also
  // self-regulates — WB tied up in in-flight escrows count as spent, pausing new
  // bids until they refund. A mid-day first run anchors to "now", so the cap
  // bounds Méphisto's own session spend rather than the whole calendar day.
  let committedCache = { at: 0, wb: 0 };
  async function committedTodayWb() {
    if (Date.now() - committedCache.at < 15_000) return committedCache.wb;
    const j = await WMC_API.balance().catch(() => null);
    if (!j || typeof j.balance !== "number") return committedCache.wb; // keep last known on failure
    const day = today();
    let ds = (await store.get({ wmcDayStart: null })).wmcDayStart;
    if (!ds || ds.day !== day) {
      ds = { day, balance: j.balance };
      await store.set({ wmcDayStart: ds });
    }
    committedCache = { at: Date.now(), wb: Math.max(0, ds.balance - j.balance) };
    return committedCache.wb;
  }
  const invalidateCommitted = () => {
    committedCache.at = 0;
  };

  // ---------- open packs ----------
  async function openPacks(cfg) {
    if (!cfg.autoOpen) return;
    const { wmcNextRegenAt } = await store.get({ wmcNextRegenAt: 0 });
    if (Date.now() < wmcNextRegenAt) return; // known empty, regen not due
    let opened = 0;
    let remaining = 0;
    // Small burst per cycle (each opens 5 cards); the next cycle continues if
    // packs remain. Keeps us well under the rate limit.
    for (let i = 0; i < 3; i++) {
      await jitter(cfg);
      const res = await WMC_API.openPack();
      if (res.status === 429) {
        backoff(180_000); // rate limited — pause 3 min
        break;
      }
      if (res.status === 403) {
        await store.set({ wmcNextRegenAt: Date.parse(res.data?.next_regen_at) || Date.now() + 600_000 });
        break;
      }
      if (!res.ok || !res.data?.cards) break;
      opened++;
      remaining = res.data.packs_remaining ?? 0;
      if (typeof WMC_DB !== "undefined") for (const c of res.data.cards) WMC_DB.recordPull(c, Date.now());
      if (remaining < (cfg.autoOpenMinStock ?? 1)) break;
    }
    if (opened) wmcNotify("😈 Paquets éventrés", `${opened} paquet(s) ouvert(s), ${remaining} restant(s).`);
  }

  // ---------- market helpers ----------
  const nextBidOf = (a) => (a.current_bidder_id ? a.current_bid + 1 : a.base_amount);
  const secondsLeft = (a) => (new Date(a.end_at).getTime() - Date.now()) / 1000;

  // Real market actions require a pseudo (to avoid bidding on / against
  // yourself). No pseudo => forced dry-run, whatever cfg.dryRun says.
  const isDry = (cfg) => cfg.dryRun || !(cfg.myUsername || "").trim();

  // Guild mates by username — cached ~10 min. We never bid on their listings and
  // never outbid them. is_self is dropped so we don't match ourselves.
  let guildCache = { at: 0, set: new Set() };
  async function guildmates() {
    if (Date.now() - guildCache.at < 600_000) return guildCache.set;
    const { members = [] } = await WMC_API.guildMembers().catch(() => ({}));
    guildCache = {
      at: Date.now(),
      set: new Set(members.filter((m) => !m.is_self).map((m) => m.profile?.username).filter(Boolean)),
    };
    return guildCache.set;
  }

  // Most we'll pay for a card: estimated value × ratio, capped by the hard ceiling
  // (maxBidWb). Falls back to the hard ceiling if the value model isn't loaded.
  const willingToPay = (card, cfg) => {
    const hard = cfg.maxBidWb ?? 30;
    if (typeof WMC_VALUE === "undefined") return hard;
    const v = WMC_VALUE.estimate(card);
    return v == null ? hard : Math.min(hard, Math.round(v * (cfg.buyValueRatio ?? 0.6)));
  };

  // ---------- endgame sniper ----------
  // With anti-snipe, a bid under ~11 s left bumps the timer by ~1 min, so an
  // auction is only ever decided in its final seconds. Bidding the instant you're
  // outbid just escalates the price early for nothing. So we stay out until an
  // eligible auction (SR+, affordable, not ours, not already led by us) enters the
  // endgame window and bid ONCE there, just above the reset threshold. If a rival
  // bids under the floor THEY trigger the extension, handing us a fresh window to
  // snipe again — so we never need to bid below the floor ourselves.
  // Runs on a fast timer in the page driver; precise timing is impossible from a
  // background service-worker alarm (min 1 min ≫ the ~10 s window), so nothing is
  // sniped with the tab closed — by design.
  const SNIPE_MIN = 12; // never bid under this — margin above the ~11 s reset + network latency
  const SNIPE_MAX = 22; // don't bid earlier — wide enough for the ~5–8 s loop to catch the window
  async function snipeEndgame() {
    const cfg = await store.get(WMC_DEFAULTS);
    if (!cfg.enabled || !cfg.autoBid) return;
    if (running || Date.now() < backoffUntil) return;
    if (isDry(cfg)) return; // no pseudo / dry-run → observe only
    const me = cfg.myUsername;
    const mates = cfg.spareGuildmates ? await guildmates() : new Set();
    // Cheap scan off the shared cache — end_at is stable, so seconds-left is
    // accurate even from a slightly old snapshot.
    const inWindow = (await getAuctions()).filter(
      (a) =>
        a.status === "active" &&
        cfg.targetRarities.includes(a.card?.rarity) &&
        a.seller?.username !== me &&
        a.current_bidder?.username !== me && // not already leading
        !mates.has(a.seller?.username) && // never bid on a guildmate's listing
        !mates.has(a.current_bidder?.username) && // never outbid a guildmate
        nextBidOf(a) <= willingToPay(a.card, cfg) && // value-based: worth it vs estimated value
        secondsLeft(a) >= SNIPE_MIN &&
        secondsLeft(a) <= SNIPE_MAX
    );
    if (!inWindow.length) return; // nothing in the endgame yet — wait, don't escalate early
    inWindow.sort((x, y) => secondsLeft(x) - secondsLeft(y)); // most urgent first
    const pick = inWindow[0];

    // Confirm on the freshest single-auction read: true price + true timing (the
    // list lags on a just-extended auction), so we bid the right amount at the
    // right moment and skip the stale-price 409 entirely.
    const a = (await WMC_API.auctionOne(pick.id).catch(() => null))?.auction;
    if (!a || a.status !== "active" || a.current_bidder?.username === me) return;
    if (mates.has(a.seller?.username) || mates.has(a.current_bidder?.username)) return; // a guildmate stepped in
    const sl = secondsLeft(a);
    if (sl < SNIPE_MIN || sl > SNIPE_MAX) return; // timing moved — catch it next tick
    const amount = nextBidOf(a);
    if (amount > willingToPay(pick.card, cfg)) return; // past what it's worth to us — let it go (pick.card = full attrs)
    if ((await committedTodayWb()) + amount > cfg.dailySpendCapWb) return;

    const res = await WMC_API.bid(pick.id, amount);
    if (res.status === 429) return backoff(120_000);
    if (res.status === 409) return invalidateAuctions(); // out-sniped in the same instant — retry next tick
    if (res.ok) {
      invalidateAuctions();
      invalidateCommitted();
      const title = a.card?.wikipedia_title ?? pick.card?.wikipedia_title;
      const rarity = a.card?.rarity ?? pick.card?.rarity;
      wmcNotify("😈 Pacte scellé", `${title} (${rarity}) pour ${amount} WB à ${Math.round(sl)}s. Remboursé si surenchéri.`);
    }
  }

  // ---------- auto-sell (flip) ----------
  async function autoSell(cfg) {
    if (!cfg.autoSell) return;
    const { wmcLastSellAt } = await store.get({ wmcLastSellAt: 0 });
    if (Date.now() - wmcLastSellAt < (cfg.bidCooldownMs ?? 20_000)) return;

    const mine = await WMC_API.myMarket().catch(() => null);
    if (!mine) return;
    if (typeof WMC_DB !== "undefined") await WMC_DB.reconcileSellAB(mine.history || []); // settle A/B outcomes
    if ((mine.selling || []).length >= (cfg.sellSlotMax ?? 5)) return; // no free slot

    const listed = new Set((mine.selling || []).map((a) => a.card?.id ?? a.card_id));
    // What we actually paid, from our won auctions (final_price) — so we list a
    // bit above cost (never at a loss). A low base still triggers the bidding war
    // that lifts the final price.
    const paidFor = {};
    for (const a of mine.won || []) {
      const id = a.card?.id ?? a.card_id;
      const p = a.final_price ?? a.current_bid;
      if (id && p != null) paidFor[id] = Math.min(paidFor[id] ?? Infinity, p);
    }
    const { cards } = await WMC_API.ownedCards().catch(() => ({ cards: [] }));
    const rank = { UR: 0, SR: 1 };
    const stat = (c) => (c.atk || 0) + (c.def || 0);
    const candidates = cards.filter(
      (c) =>
        cfg.sellRarities.includes(c.rarity) && // UR/SR only — never Legendaries
        !(cfg.sellSkipStarred && c.starred) && // keep favourites
        !listed.has(c.id)
    );
    if (!candidates.length) return;

    // Strategy — "B" = new (highest value first: UR then top battle stats, UR listed
    // longer so whales bid it up). "A" = old (random pick, short duration). When the
    // A/B test is on, flip a coin per listing and record the outcome to compare.
    const strat = cfg.sellAbTest && chance(0.5) ? "A" : "B";
    let card, duration;
    if (strat === "A") {
      card = pickOne(candidates);
      duration = cfg.sellDurationMin ?? 10;
    } else {
      const ranked = candidates.slice().sort((a, b) => (rank[a.rarity] ?? 9) - (rank[b.rarity] ?? 9) || stat(b) - stat(a));
      card = pickOne(ranked.slice(0, 5));
      duration = card.rarity === "UR" ? (cfg.sellDurationUrMin ?? 360) : (cfg.sellDurationMin ?? 10);
    }
    // A bit above what we paid when we know it (≈ +15%, min +1) so we never list
    // below cost; otherwise a low default base. A low base draws bidders who war it up.
    const paid = paidFor[card.id];
    const price =
      paid != null
        ? Math.max(paid + 1, Math.round(paid * 1.15))
        : Math.max(1, Math.round(cfg.sellStartWb * rnd(0.85, 1.2)));

    if (isDry(cfg)) {
      wmcNotify("😈 Illusion (dry-run)", `[${strat}] Aurait mis en vente ${card.wikipedia_title} (${card.rarity}) à ${price} WB (${duration} min).`);
      await store.set({ wmcLastSellAt: Date.now() });
      return;
    }
    await jitter(cfg);
    const res = await WMC_API.listCard(card.id, price, duration);
    await store.set({ wmcLastSellAt: Date.now() });
    if (res.status === 429) return backoff(180_000);
    if (res.ok) {
      wmcNotify("😈 Carte en vente", `[${strat}] ${card.wikipedia_title} (${card.rarity}) listée à ${price} WB.`);
      // Tag the fresh listing with its strategy so we can score A vs B later.
      if (cfg.sellAbTest && typeof WMC_DB !== "undefined") {
        const m2 = await WMC_API.myMarket().catch(() => null);
        const listing = (m2?.selling || []).find((a) => (a.card?.id ?? a.card_id) === card.id);
        if (listing)
          await WMC_DB.recordSellAB({ auctionId: listing.id, strategy: strat, cardId: card.id, title: card.wikipedia_title, rarity: card.rarity, stat: stat(card), base: price, durationMin: duration, listedAt: Date.now() });
      }
    }
  }

  // ---------- target watch ----------
  // Observe one player's market moves (their listings + their bids, with amounts
  // and timing) and stash them in the DB, deduped, for JSON export/analysis.
  // Only runs where we can store (content-script DB present) and stays gentle:
  // a few single-auction reads per pass, spaced out.
  async function watchTarget(cfg) {
    if (typeof WMC_DB === "undefined") return; // no DB in this context (e.g. service worker)
    // Comma-separated list of usernames to watch (comma only — usernames can contain spaces).
    const targets = new Set((cfg.targetPlayer || "").split(",").map((t) => t.trim()).filter(Boolean));
    if (!targets.size) return;
    const involved = (await getAuctions()).filter(
      (a) => targets.has(a.seller?.username) || targets.has(a.current_bidder?.username)
    );
    if (!involved.length) return;
    const rows = [];
    const now = Date.now();
    for (const a of involved.slice(0, 6)) {
      const base = {
        auctionId: a.id,
        cardId: a.card?.id ?? a.card_id,
        title: a.card?.wikipedia_title,
        rarity: a.card?.rarity ?? a.snapshot_rarity,
        atk: a.snapshot_atk,
        def: a.snapshot_def,
        endAt: a.end_at,
      };
      if (targets.has(a.seller?.username)) {
        rows.push({ ...base, user: a.seller.username, key: `l:${a.id}`, type: "listing", baseAmount: a.base_amount, currentBid: a.current_bid, at: now });
      }
      const one = await WMC_API.auctionOne(a.id).catch(() => null);
      for (const b of one?.bids || []) {
        if (!targets.has(b.bidder?.username)) continue;
        rows.push({ ...base, user: b.bidder.username, key: `b:${b.id}`, type: "bid", amount: b.amount, placedAt: b.placed_at, at: new Date(b.placed_at).getTime() || now });
      }
      // Trade edge (WB flows buyer -> seller). One row per auction, updated as it
      // progresses/settles; lets us reconstruct the net-flow graph → the hub account.
      const fresh = one?.auction || a;
      const buyer = fresh.winner?.username || fresh.current_bidder?.username;
      const price = fresh.final_price ?? fresh.current_bid;
      if (buyer && price != null) {
        rows.push({
          ...base,
          user: targets.has(fresh.seller?.username) ? fresh.seller.username : buyer,
          key: `t:${a.id}`, type: "trade",
          seller: fresh.seller?.username, buyer, price, settled: fresh.status,
          at: now,
        });
      }
      await sleep(rnd(300, 800)); // space out the single-auction reads
    }
    if (rows.length) await WMC_DB.recordTargetObs(rows);
  }

  // ---------- one full cycle ----------
  async function runCycle() {
    if (running || Date.now() < backoffUntil) return; // no overlap, respect back-off
    const cfg = await store.get(WMC_DEFAULTS);
    if (!cfg.enabled) return;
    running = true;
    try {
      // Shuffle the job order and occasionally skip one — humans aren't tidy.
      // Bidding is NOT here — it's the endgame sniper on its own fast timer.
      const jobs = shuffle([() => openPacks(cfg), () => autoSell(cfg), () => watchTarget(cfg)]);
      for (const job of jobs) {
        if (chance(0.15)) continue;
        await job();
        await sleep(rnd(400, 1800)); // irregular gap between jobs
      }
    } catch (_) {
      /* transient network/auth error — retry next cycle */
    } finally {
      running = false;
    }
  }

  return { runCycle, openPacks, autoSell, snipeEndgame };
})();
