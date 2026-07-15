// Guild module: periodically checks the guild wishlist and surfaces cards you
// can gift right now (biggest guild-score lever: +100 C … +2000 L per gift,
// 1 gift received/day/member). Notifies; optional auto-gift uses the endpoint
// LEARNED by the sniffer the first time you gift manually — never a guess.

(async () => {
  const cfg = await new Promise((r) => chrome.storage.local.get(WMC_DEFAULTS, r));
  chrome.storage.onChanged.addListener((changes) => {
    for (const [key, { newValue }] of Object.entries(changes)) cfg[key] = newValue;
  });

  let lastGiftDay = null;
  const notified = new Set();

  async function tick() {
    if (!cfg.guildWatch) return;
    const home = await WMC_API.guildHome().catch(() => null);
    if (!home) return;

    const matches = WMC_ANALYSIS.wishlistMatches(home);
    for (const m of matches) {
      if (!notified.has(m.entryId)) {
        notified.add(m.entryId);
        wmcSend({
          type: "guild:match",
          title: m.title,
          rarity: m.rarity,
          to: m.to,
          points: m.points,
        });
      }
    }

    if (cfg.enabled && cfg.autoGift) await maybeAutoGift(matches);
  }

  // Auto-gift the single highest-value match per day (one gift/member/day is
  // enforced server-side; we self-limit to one gift action per UTC day).
  async function maybeAutoGift(matches) {
    const today = new Date().toISOString().slice(0, 10);
    if (lastGiftDay === today) return;

    const learned = await WMC_DB.getEndpoint("gift");
    if (!learned) return; // do nothing until the gift endpoint is observed once
    const best = matches[0];
    if (!best) return;

    // Reproduce the observed payload shape, substituting our target.
    const body = { ...(learned.sample || {}), entryId: best.entryId, cardId: best.cardId };
    if (cfg.dryRun) {
      wmcSend({ type: "guild:dryrun", to: best.to, title: best.title, points: best.points });
      lastGiftDay = today;
      return;
    }
    const res = await WMC_API.post(learned.route, body);
    if (res.ok) {
      lastGiftDay = today;
      wmcSend({ type: "guild:gift", to: best.to, title: best.title, points: best.points });
    }
  }

  setInterval(tick, WMC_DEFAULTS.scanIntervalMs);
  tick();
})();
