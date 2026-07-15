// Automation engine — SHARED by the service worker (desktop, runs even with
// the tab closed) and the Android WebView in-page driver. Fully API-driven
// (WMC_API), so it is page-independent: no need to be on /pulls or
// /marketplace, and no page-switching. State persists in chrome.storage.
//
// Three jobs each cycle: open packs, auto-bid (reactive "defend"), auto-sell
// (flip owned cards higher). All bounded by the guardrails in config.js.

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

  async function spentToday() {
    const s = await store.get({ wmcSpendDay: today(), wmcSpendWb: 0 });
    return s.wmcSpendDay === today() ? s.wmcSpendWb : 0;
  }
  async function addSpend(wb) {
    await store.set({ wmcSpendDay: today(), wmcSpendWb: (await spentToday()) + wb });
  }

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

  // ---------- auto-bid (reactive defend) ----------
  const ANTI_SNIPE_FLOOR = 15;
  const nextBidOf = (a) => (a.current_bidder_id ? a.current_bid + 1 : a.base_amount);
  const secondsLeft = (a) => (new Date(a.end_at).getTime() - Date.now()) / 1000;

  // Real market actions require a pseudo (to avoid bidding on / against
  // yourself). No pseudo => forced dry-run, whatever cfg.dryRun says.
  const isDry = (cfg) => cfg.dryRun || !(cfg.myUsername || "").trim();

  async function autoBid(cfg) {
    if (!cfg.autoBid) return;
    const { wmcLastBidAt } = await store.get({ wmcLastBidAt: 0 });
    if (Date.now() - wmcLastBidAt < (cfg.bidCooldownMs ?? 20_000)) return;

    const { auctions = [] } = await WMC_API.auctions("ending_soon", 1, 50).catch(() => ({}));
    if (typeof WMC_DB !== "undefined") {
      const now = Date.now();
      for (const a of auctions) WMC_DB.recordAuction(a, now); // price history for the dashboard
    }
    const me = cfg.myUsername;
    const eligible = auctions.filter(
      (a) =>
        a.status === "active" &&
        cfg.targetRarities.includes(a.card?.rarity) &&
        a.seller?.username !== me &&
        a.current_bidder?.username !== me && // not already leading
        nextBidOf(a) <= cfg.maxBidWb &&
        secondsLeft(a) > ANTI_SNIPE_FLOOR
    );
    if (!eligible.length) return;

    const byPrice = (list) => list.slice().sort((x, y) => nextBidOf(x) - nextBidOf(y));
    const cheapest = (list) => byPrice(list)[0];
    // Don't always grab the absolute cheapest — pick randomly among the 3
    // cheapest, so choices aren't perfectly predictable.
    const cheapishRandom = (list) => pickOne(byPrice(list).slice(0, 3));
    let pick;
    if (cfg.bidStrategy === "defend") {
      // Re-claim auctions we already invested in (proxy-bid up to maxBidWb to
      // actually WIN) before starting a new one; keep defending strategic.
      const engaged = new Set((await store.get({ wmcEngaged: [] })).wmcEngaged);
      pick = cheapest(eligible.filter((a) => engaged.has(a.id))) || cheapishRandom(eligible);
    } else {
      pick = cheapishRandom(eligible); // legacy "cheap"
    }

    const amount = nextBidOf(pick);
    if ((await spentToday()) + amount > cfg.dailySpendCapWb) return;

    if (isDry(cfg)) {
      wmcNotify("😈 Illusion (dry-run)", `Aurait misé ${amount} WB sur ${pick.card?.wikipedia_title} (${pick.card?.rarity}).`);
      await store.set({ wmcLastBidAt: Date.now() });
      return;
    }
    await jitter(cfg);
    const res = await WMC_API.bid(pick.id, amount);
    await store.set({ wmcLastBidAt: Date.now() });
    if (res.status === 429) return backoff(180_000); // rate limited — pause
    if (res.ok) {
      await addSpend(amount);
      const engaged = new Set((await store.get({ wmcEngaged: [] })).wmcEngaged);
      engaged.add(pick.id);
      await store.set({ wmcEngaged: [...engaged].slice(-100) });
      wmcNotify("😈 Pacte scellé", `${pick.card?.wikipedia_title} (${pick.card?.rarity}) pour ${amount} WB. Remboursé si surenchéri.`);
    }
  }

  // ---------- auto-sell (flip) ----------
  async function autoSell(cfg) {
    if (!cfg.autoSell) return;
    const { wmcLastSellAt } = await store.get({ wmcLastSellAt: 0 });
    if (Date.now() - wmcLastSellAt < (cfg.bidCooldownMs ?? 20_000)) return;

    const mine = await WMC_API.myMarket().catch(() => null);
    if (!mine) return;
    if ((mine.selling || []).length >= (cfg.sellSlotMax ?? 5)) return; // no free slot

    const listed = new Set((mine.selling || []).map((a) => a.card?.id ?? a.card_id));
    const { cards } = await WMC_API.ownedCards().catch(() => ({ cards: [] }));
    const order = { L: 0, UR: 1, SR: 2 };
    const candidates = cards
      .filter(
        (c) =>
          cfg.sellRarities.includes(c.rarity) &&
          !(cfg.sellSkipStarred && c.starred) && // keep favourites
          !listed.has(c.id)
      )
      .sort((a, b) => (order[a.rarity] ?? 9) - (order[b.rarity] ?? 9));
    if (!candidates.length) return;
    // Favour higher rarity but pick randomly among the top few, and vary the
    // price a bit so listings aren't carbon copies.
    const card = pickOne(candidates.slice(0, 5));
    const price = Math.max(1, Math.round(cfg.sellStartWb * rnd(0.85, 1.2)));

    if (isDry(cfg)) {
      wmcNotify("😈 Illusion (dry-run)", `Aurait mis en vente ${card.wikipedia_title} (${card.rarity}) à ${price} WB.`);
      await store.set({ wmcLastSellAt: Date.now() });
      return;
    }
    await jitter(cfg);
    const res = await WMC_API.listCard(card.id, price, cfg.sellDurationMin);
    await store.set({ wmcLastSellAt: Date.now() });
    if (res.status === 429) return backoff(180_000);
    if (res.ok) wmcNotify("😈 Carte en vente", `${card.wikipedia_title} (${card.rarity}) listée à ${price} WB.`);
  }

  // ---------- one full cycle ----------
  async function runCycle() {
    if (running || Date.now() < backoffUntil) return; // no overlap, respect back-off
    const cfg = await store.get(WMC_DEFAULTS);
    if (!cfg.enabled) return;
    running = true;
    try {
      // Shuffle the job order and occasionally skip one — humans aren't tidy.
      const jobs = shuffle([() => openPacks(cfg), () => autoBid(cfg), () => autoSell(cfg)]);
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

  return { runCycle, openPacks, autoBid, autoSell };
})();
