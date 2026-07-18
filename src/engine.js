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

  // Trace une action dans le journal du dashboard (best-effort, jamais bloquant).
  const wmcAction = (type, text, extra) => {
    try {
      if (typeof WMC_DB !== "undefined") WMC_DB.recordAction({ type, text, ...extra });
    } catch (_) { /* pas de DB dans ce contexte (service worker) — le journal est un bonus */ }
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
    if (opened) {
      wmcNotify("😈 Paquets éventrés", `${opened} paquet(s) ouvert(s), ${remaining} restant(s).`);
      wmcAction("pack", `${opened} paquet(s) ouvert(s), ${remaining} restant(s)`);
    }
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

  // Cached desirability signals for a card (or null — un-enriched or no DB, e.g.
  // service worker). value.js reads this to score UR/L desirability.
  async function cardMeta(card) {
    if (typeof WMC_DB === "undefined" || !card?.wikipedia_title) return null;
    return WMC_DB.getCardMeta(card.wikipedia_title).catch(() => null);
  }

  // État interest: tags de l'utilisateur + racines de catégorie par tag + graphe
  // local des parents. Cache mémoire 10 min (le backfill l'invalide en écrivant).
  let interestCache = { at: 0, tags: [], rootsByTag: [], parents: new Map() };
  const interestReady = () =>
    typeof WMC_TAGSYNC !== "undefined" && typeof WMC_ANCESTRY !== "undefined" &&
    typeof WMC_INTEREST !== "undefined" && typeof WMC_DB !== "undefined" && typeof document !== "undefined";
  async function interestState(cfg) {
    if (!interestReady()) return { tags: [], rootsByTag: [], parents: new Map() };
    if (Date.now() - interestCache.at < 600_000 && interestCache.rootsByTag.length) return interestCache;
    const tags = await WMC_TAGSYNC.listTags();
    const rootsByTag = [];
    for (const t of tags) rootsByTag.push({ tagId: t.id, roots: await WMC_ANCESTRY.rootsFor(t.name, cfg) });
    interestCache = {
      at: Date.now(),
      tags: tags.map((t) => ({ tagId: t.id, name: t.name })),
      rootsByTag,
      parents: await WMC_ANCESTRY.parentsMap(),
    };
    return interestCache;
  }
  const invalidateInterest = () => { interestCache.at = 0; };

  // Tags d'une carte: ascendance de graphe si on a ses catégories, sinon
  // fast-path titre (instantané, sans réseau). depth = curseur précision/rappel.
  const onThemeTags = (card, meta, state, depth) => {
    if (typeof WMC_INTEREST === "undefined" || !state.rootsByTag.length) return [];
    const cats = meta && Array.isArray(meta.categories) ? meta.categories : null;
    if (cats && cats.length)
      return Object.keys(WMC_INTEREST.walkAncestry(cats, state.rootsByTag, state.parents, depth));
    return WMC_INTEREST.titleTags(card, state.tags);
  };

  // Plafond de mise applicable : dédié aux centres d'intérêt (on-theme, toutes
  // raretés), sinon par rareté pour les cartes normales, avec maxBidWb en filet
  // de sécurité. Mettre un plafond à 0 = ne jamais miser sur cette catégorie.
  const RARITY_BID_KEY = { L: "maxBidLWb", UR: "maxBidUrWb", SR: "maxBidSrWb" };
  const bidCeiling = (card, cfg, onTheme) => {
    if (onTheme && cfg.interestAutoBid) return cfg.maxBidInterestWb ?? cfg.maxBidWb ?? 30;
    const k = RARITY_BID_KEY[card?.rarity];
    const cap = k ? cfg[k] : undefined;
    return cap ?? cfg.maxBidWb ?? 30;
  };
  // Most we'll pay for a card: estimated value × ratio + bonus on-theme, borné
  // par le plafond ci-dessus. `meta` = cached desirability signals.
  const willingToPay = (card, meta, cfg, onTheme) => {
    const hard = bidCeiling(card, cfg, onTheme);
    let base = hard;
    if (typeof WMC_VALUE !== "undefined") {
      const v = WMC_VALUE.estimate(card, meta);
      base = v == null ? hard : Math.round(v * (cfg.buyValueRatio ?? 0.6));
    }
    if (onTheme && cfg.interestAutoBid) base += cfg.interestBidBonus ?? 0;
    return Math.min(hard, base);
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
    const state = cfg.interestAutoBid ? await interestState(cfg) : { tags: [], rootsByTag: [], parents: new Map() };
    // Cheap scan off the shared cache — end_at is stable, so seconds-left is
    // accurate even from a slightly old snapshot. Sync filters first (ownership,
    // guild, timing) ; la rareté se décide dans la boucle async — une carte
    // on-theme est éligible quelle que soit sa rareté.
    const candidates = (await getAuctions()).filter(
      (a) =>
        a.status === "active" &&
        a.seller?.username !== me &&
        a.current_bidder?.username !== me && // not already leading
        !mates.has(a.seller?.username) && // never bid on a guildmate's listing
        !mates.has(a.current_bidder?.username) && // never outbid a guildmate
        secondsLeft(a) >= SNIPE_MIN &&
        secondsLeft(a) <= SNIPE_MAX
    );
    if (!candidates.length) return; // nothing in the endgame yet — wait, don't escalate early
    // Value gate: only keep auctions whose next bid is within what the card is
    // worth to us (desirability-based). Un-enriched cards score conservatively.
    const inWindow = [];
    for (const a of candidates) {
      const meta = await cardMeta(a.card);
      a.__onTheme = onThemeTags(a.card, meta, state, cfg.interestDepthMarket ?? 4).length > 0;
      // On-theme : toutes les raretés. Normale : raretés cibles uniquement (SR+ par défaut).
      if (!a.__onTheme && !cfg.targetRarities.includes(a.card?.rarity)) continue;
      if (nextBidOf(a) <= willingToPay(a.card, meta, cfg, a.__onTheme)) inWindow.push(a);
    }
    if (!inWindow.length) return;
    const themed = (a) => (cfg.interestAutoBid && a.__onTheme ? 0 : 1);
    inWindow.sort((x, y) => themed(x) - themed(y) || secondsLeft(x) - secondsLeft(y));
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
    const pickMeta = await cardMeta(pick.card); // pick.card = full attrs (list); a.card may be partial
    if (amount > willingToPay(pick.card, pickMeta, cfg, onThemeTags(pick.card, pickMeta, state, cfg.interestDepthMarket ?? 4).length > 0)) return; // past what it's worth to us — let it go
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
      wmcAction("bid", `${title} (${rarity}) — mise ${amount} WB${pick.__onTheme ? " · centre d'intérêt" : ""}`, { amount, onTheme: !!pick.__onTheme });
    }
  }

  // ---------- auto-sell (flip) ----------
  async function autoSell(cfg) {
    if (!cfg.autoSell) return;
    const { wmcLastSellAt } = await store.get({ wmcLastSellAt: 0 });
    if (Date.now() - wmcLastSellAt < (cfg.bidCooldownMs ?? 20_000)) return;
    // Protection on-theme impossible à évaluer hors du content-script (ex. service
    // worker : pas de modules interest ni de document/cookies) -> on ne vend pas.
    if (cfg.interestProtectSell && !interestReady()) return;

    const mine = await WMC_API.myMarket().catch(() => null);
    if (!mine) return;
    if (typeof WMC_DB !== "undefined") {
      await WMC_DB.reconcileSellAB(mine.history || []); // settle A/B outcomes
      // Record real clearing prices of our settled-sold auctions, so value can be
      // anchored on what the market actually pays (accumulates over time).
      const sold = (mine.history || []).filter((h) => h.status === "settled_sold");
      await WMC_DB.recordSale(
        sold
          .map((h) => {
            const c = h.card || h;
            const final = h.final_price ?? h.current_bid;
            return final != null && c.wikipedia_title
              ? { key: h.id, title: c.wikipedia_title, rarity: c.rarity, final, soldAt: Date.now() }
              : null;
          })
          .filter(Boolean)
      );
    }
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
    const state = cfg.interestProtectSell ? await interestState(cfg) : { tags: [], rootsByTag: [], parents: new Map() };
    let candidates = cards.filter(
      (c) =>
        cfg.sellRarities.includes(c.rarity) && // UR/SR only — never Legendaries
        !(cfg.sellSkipStarred && c.starred) && // keep favourites
        !listed.has(c.id)
    );
    if (cfg.interestProtectSell && state.rootsByTag.length) {
      const depth = cfg.interestDepthMarket ?? 4;
      const kept = [];
      for (const c of candidates) {
        const meta = await cardMeta(c);
        const cats = meta && Array.isArray(meta.categories) ? meta.categories : null;
        if (onThemeTags(c, meta, state, depth).length) continue; // on-theme -> jamais vendue
        // Graphe incomplet pour cette carte -> impossible d'évaluer -> on ne vend pas (fail-closed).
        if (cats && cats.length && WMC_INTEREST.missingParents(cats, state.parents, depth).length) continue;
        kept.push(c);
      }
      if (kept.length < candidates.length)
        wmcAction("protect", `${candidates.length - kept.length} carte(s) épargnée(s) de la vente (centres d'intérêt ou graphe incomplet)`);
      candidates = kept;
    }
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
    let price =
      paid != null
        ? Math.max(paid + 1, Math.round(paid * 1.15))
        : Math.max(1, Math.round(cfg.sellStartWb * rnd(0.85, 1.2)));
    // Floor for UR/L so we never give a high-rarity card away at ~10 WB (observed:
    // URs cleared at 10-16 regardless of base — no bidding war forms). The floor
    // scales with DESIRABILITY (langs/backlinks/steadiness), not pageviews — an
    // obscure 26k-view UR cleared at 10 while a French icon reached ~600. Desirable
    // cards start higher (they'll get bid up anyway); obscure ones stay modest so
    // they still clear. The auction discovers the premium above the floor.
    // SR/commons keep the low base (~13 WB commodities).
    if (card.rarity === "UR" || card.rarity === "L") {
      // Enrich the card now if we've never seen it — auto-sell lists our OWN
      // cards, which the market-facing enrichment pass may never have valued, so
      // desirable ones would otherwise fall back to the base floor.
      let sellMeta = await cardMeta(card);
      if (!sellMeta && typeof WMC_ENRICH !== "undefined" && typeof WMC_DB !== "undefined" && card.wikipedia_title) {
        const sig = await WMC_ENRICH.fetchSignals(card.wikipedia_title, card.lang).catch(() => null);
        if (sig) {
          const sc = typeof WMC_VALUE !== "undefined" ? WMC_VALUE.desirabilityScore(sig) : null;
          await WMC_DB.putCardMeta({ title: card.wikipedia_title, ...sig, score: sc });
          sellMeta = { ...sig, score: sc };
        }
      }
      const score = typeof WMC_VALUE !== "undefined" ? WMC_VALUE.desirabilityScore(sellMeta) : null;
      const floor =
        score == null
          ? cfg.sellUrFloorWb ?? 25
          : score >= 4
            ? cfg.sellUrFloorHighWb ?? 80
            : score >= 2
              ? cfg.sellUrFloorMidWb ?? 40
              : cfg.sellUrFloorWb ?? 25;
      price = Math.max(price, floor);
    }

    if (isDry(cfg)) {
      wmcNotify("😈 Illusion (dry-run)", `[${strat}] Aurait mis en vente ${card.wikipedia_title} (${card.rarity}) à ${price} WB (${duration} min).`);
      wmcAction("sell", `(dry-run) ${card.wikipedia_title} (${card.rarity}) à ${price} WB`, { dryRun: true, price });
      await store.set({ wmcLastSellAt: Date.now() });
      return;
    }
    await jitter(cfg);
    const res = await WMC_API.listCard(card.id, price, duration);
    await store.set({ wmcLastSellAt: Date.now() });
    if (res.status === 429) return backoff(180_000);
    if (res.ok) {
      wmcNotify("😈 Carte en vente", `[${strat}] ${card.wikipedia_title} (${card.rarity}) listée à ${price} WB.`);
      wmcAction("sell", `${card.wikipedia_title} (${card.rarity}) listée à ${price} WB`, { price });
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

  // ---------- desirability enrichment ----------
  // Fetch + cache Wikipedia signals for the UR/L cards currently on the market so
  // the sniper can value them by desirability. Rate-limited inside enrichSeen.
  async function enrichCards(cfg) {
    if (typeof WMC_ENRICH === "undefined" || typeof WMC_DB === "undefined") return;
    const cards = (await getAuctions().catch(() => [])).map((a) => a.card).filter(Boolean);
    // Repérage/auto-bid on-theme : il faut les catégories de TOUTES les raretés du marché.
    const marketOpts = cfg.interestWatch || cfg.interestAutoBid ? { rarities: ["L", "UR", "SR", "R", "PC", "C"] } : undefined;
    await WMC_ENRICH.enrichSeen(cards, cfg.enrichPerCycle ?? 3, marketOpts);
    if (cfg.interestAutoTag || cfg.interestProtectSell) {
      const owned = (await WMC_API.ownedCards().catch(() => ({ cards: [] }))).cards || [];
      await WMC_ENRICH.enrichSeen(owned, cfg.enrichPerCycle ?? 3, { rarities: ["L", "UR", "SR", "R", "PC", "C"] });
    }
  }

  // ---------- interest: auto-tag owned cards ----------
  async function interestAutoTag(cfg) {
    if (!cfg.interestAutoTag) return;
    const state = await interestState(cfg);
    if (!state.rootsByTag.length) return;
    const already = await WMC_TAGSYNC.listAssignments();
    const owned = (await WMC_API.ownedCards().catch(() => ({ cards: [] }))).cards || [];
    const pairs = [];
    for (const c of owned) {
      const ucid = c.userCardId;
      if (!ucid) continue;
      const meta = await cardMeta(c);
      for (const tagId of onThemeTags(c, meta, state, cfg.interestDepthTag ?? 3)) {
        if (!already.has(`${ucid}|${tagId}`)) pairs.push({ user_card_id: ucid, tag_id: tagId });
      }
    }
    if (!pairs.length) return;
    const res = await WMC_TAGSYNC.assignTags(pairs, isDry(cfg));
    wmcNotify(isDry(cfg) ? "😈 Étiquetage (dry-run)" : "😈 Cartes étiquetées",
      `${res.count} étiquette(s) ${isDry(cfg) ? "seraient posées" : "posées"}.`);
    wmcAction("tag", `${res.count} étiquette(s) ${isDry(cfg) ? "seraient posées (dry-run)" : "posées"}`, { dryRun: isDry(cfg), count: res.count });
  }

  // ---------- interest: market scan ----------
  async function interestMarketScan(cfg) {
    if (!cfg.interestWatch) return;
    const state = await interestState(cfg);
    if (!state.rootsByTag.length) return;
    const active = (await getAuctions().catch(() => []))
      .filter((a) => a.status === "active"); // toutes raretés — seul l'on-theme est retenu ensuite
    const hits = [];
    for (const a of active) {
      const meta = await cardMeta(a.card);
      if (onThemeTags(a.card, meta, state, cfg.interestDepthMarket ?? 4).length) hits.push(a);
    }
    if (!hits.length) return;
    const { wmcInterestSeen = {} } = await store.get({ wmcInterestSeen: {} });
    const fresh = hits.filter((a) => !wmcInterestSeen[a.id]);
    if (!fresh.length) return;
    const now = Date.now();
    for (const a of fresh) wmcInterestSeen[a.id] = now;
    for (const k of Object.keys(wmcInterestSeen)) if (now - wmcInterestSeen[k] > 21_600_000) delete wmcInterestSeen[k];
    await store.set({ wmcInterestSeen });
    wmcNotify("😈 Carte à ton goût au marché",
      `${fresh.length} enchère(s) on-theme, ex. ${fresh[0].card?.wikipedia_title} (${fresh[0].card?.rarity}).`);
    wmcAction("watch", `${fresh.length} enchère(s) on-theme repérée(s), ex. ${fresh[0].card?.wikipedia_title} (${fresh[0].card?.rarity})`);
  }

  // ---------- backfill du graphe (interest) ----------
  // Complète le cache des parents pour les cartes possédées (et le marché si le
  // repérage est actif), avec un budget d'appels par cycle. La couverture — donc
  // le rappel — augmente cycle après cycle ; le fast-path titre couvre l'attente.
  async function ancestryBackfill(cfg) {
    if (!(cfg.interestAutoTag || cfg.interestProtectSell || cfg.interestWatch || cfg.interestAutoBid)) return;
    if (!interestReady()) return;
    const state = await interestState(cfg);
    if (!state.rootsByTag.length) return;
    const depth = Math.max(cfg.interestDepthTag ?? 3, cfg.interestDepthMarket ?? 4);
    const missing = new Set();
    const collect = async (cards) => {
      for (const c of cards) {
        const meta = await cardMeta(c);
        const cats = meta && Array.isArray(meta.categories) ? meta.categories : null;
        if (!cats || !cats.length) continue;
        for (const m of WMC_INTEREST.missingParents(cats, state.parents, depth)) missing.add(m);
        if (missing.size > 400) break; // assez de travail pour ce cycle
      }
    };
    await collect(((await WMC_API.ownedCards().catch(() => ({ cards: [] }))).cards) || []);
    if (cfg.interestWatch || cfg.interestAutoBid)
      await collect((await getAuctions().catch(() => [])).map((a) => a.card).filter(Boolean));
    if (!missing.size) return;
    const calls = await WMC_ANCESTRY.fillParents([...missing], cfg.ancestryFetchPerCycle ?? 4);
    if (calls) invalidateInterest(); // de nouveaux parents sont en cache
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
      const jobs = shuffle([
        () => openPacks(cfg), () => autoSell(cfg), () => watchTarget(cfg),
        () => enrichCards(cfg), () => interestAutoTag(cfg), () => interestMarketScan(cfg),
        () => ancestryBackfill(cfg),
      ]);
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

  return { runCycle, openPacks, autoSell, snipeEndgame, invalidateInterest, willingToPay };
})();
