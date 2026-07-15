// Content script for /marketplace: logs every auction seen (price history),
// scores deals against the historical median for the rarity, highlights +
// notifies, and (opt-in) places capped bids. Dry-run logs intended bids
// without firing.
//
// API (verified 2026-07-15, see docs/recon.md):
//   GET  /api/marketplace?page=1&limit=50&sort=ending_soon -> { auctions:[...] }
//   POST /api/marketplace/<id>/bid  {"amount":N} -> { current_bid, bidder_balance }
// Min bid = current_bid + 1 (or base_amount if no bidder).
// Anti-snipe: a bid in the last 10s extends the auction by 60s, so we never
// bid under ANTI_SNIPE_FLOOR_SEC to avoid extension wars.

(async () => {
  const cfg = await new Promise((r) => chrome.storage.local.get(WMC_DEFAULTS, r));
  chrome.storage.onChanged.addListener((changes) => {
    for (const [key, { newValue }] of Object.entries(changes)) cfg[key] = newValue;
  });

  const onMarketPage = () => location.pathname.startsWith("/marketplace");
  const ANTI_SNIPE_FLOOR_SEC = 15;
  let lastBidAt = 0;

  async function spentToday() {
    const today = new Date().toISOString().slice(0, 10);
    const { wmcSpendDay, wmcSpendWb } = await chrome.storage.local.get({ wmcSpendDay: today, wmcSpendWb: 0 });
    return wmcSpendDay === today ? wmcSpendWb : 0;
  }
  async function recordSpend(amount) {
    const today = new Date().toISOString().slice(0, 10);
    await chrome.storage.local.set({ wmcSpendDay: today, wmcSpendWb: (await spentToday()) + amount });
  }

  const nextBidOf = (a) => (a.current_bidder_id ? a.current_bid + 1 : a.base_amount);
  const secondsLeft = (a) => (new Date(a.end_at).getTime() - Date.now()) / 1000;

  // A deal is: right rarity, affordable next bid, time left, not mine, and —
  // when we have history — priced below dealMedianRatio of the rarity median.
  async function scoreDeal(a) {
    if (a.status !== "active") return null;
    if (!cfg.targetRarities.includes(a.card?.rarity)) return null;
    const next = nextBidOf(a);
    if (next > cfg.maxBidWb) return null;
    if (secondsLeft(a) <= ANTI_SNIPE_FLOOR_SEC) return null;
    if (a.seller?.username === cfg.myUsername || a.current_bidder?.username === cfg.myUsername) return null;

    // The hard gate is the flat ceiling (maxBidWb). The rarity median is only
    // an advisory "great deal" flag — it can't gate, because most observations
    // are low starting bids, so the median sits near 1 and would reject
    // everything. `steal` marks auctions priced well under a meaningful median.
    const median = await WMC_DB.medianPriceByRarity(a.card.rarity);
    const steal = median != null && median >= 5 && next <= median * cfg.dealMedianRatio;
    return { id: a.id, next, rarity: a.card.rarity, title: a.card?.wikipedia_title, median, steal };
  }

  // React re-renders the listing cards (countdowns tick every second) and
  // wipes inline styles, so we cache the current deal ids and re-apply the
  // outline on a short interval instead of once per scan.
  let dealIds = new Set();
  function applyHighlights() {
    if (!dealIds.size) return;
    for (const a of document.querySelectorAll('a[href^="/marketplace/"]')) {
      const id = a.getAttribute("href")?.split("/").pop();
      if (dealIds.has(id) && a.style.outline.indexOf("34, 197, 94") === -1) {
        a.style.outline = "3px solid #22c55e";
        a.style.outlineOffset = "2px";
      }
    }
  }

  async function maybeAutoBid(deals) {
    if (!cfg.enabled || !cfg.autoBid) return;
    if (Date.now() - lastBidAt < cfg.bidCooldownMs) return;

    const deal = deals.sort((x, y) => x.next - y.next)[0];
    if (!deal) return;
    if ((await spentToday()) + deal.next > cfg.dailySpendCapWb) return;

    if (cfg.dryRun) {
      wmcSend({ type: "market:dryrun", ...deal });
      lastBidAt = Date.now();
      return;
    }

    const [minJ, maxJ] = cfg.actionJitterMs;
    await new Promise((r) => setTimeout(r, minJ + Math.random() * (maxJ - minJ)));
    const res = await WMC_API.bid(deal.id, deal.next);
    lastBidAt = Date.now();
    if (res.ok) {
      await recordSpend(deal.next);
      wmcSend({ type: "market:bid", card: deal.title, rarity: deal.rarity, amount: deal.next });
    }
  }

  async function tick() {
    if (!onMarketPage() || !cfg.marketWatch) return;
    const { auctions = [] } = await WMC_API.auctions("ending_soon").catch(() => ({}));
    const now = Date.now();
    for (const a of auctions) await WMC_DB.recordAuction(a, now); // price history

    const scored = (await Promise.all(auctions.map(scoreDeal))).filter(Boolean);
    dealIds = new Set(scored.map((d) => d.id));
    if (!scored.length) return;

    applyHighlights();
    wmcSend({
      type: "market:deals",
      deals: scored.map((d) => ({ href: `/marketplace/${d.id}`, rarity: d.rarity, bidWb: d.next })),
    });
    await maybeAutoBid(scored);
  }

  setInterval(tick, WMC_DEFAULTS.scanIntervalMs);
  setInterval(applyHighlights, 2500); // keep outlines alive across React re-renders
  tick();
})();
