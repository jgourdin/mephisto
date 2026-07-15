// Runs the automation engine from within the game tab. Page-independent: the
// engine works off the API (WMC_API), so it opens packs / bids / sells no
// matter which WikiMasters page is showing — no page-switching needed. It runs
// only while a game tab is open (foreground gives full cadence; a backgrounded
// tab is throttled by the browser). Nothing runs when the tab is closed — by
// design, so the bot never spends unattended.

(() => {
  if (!/wiki-masters\.com$/.test(location.hostname)) return;

  let base = WMC_DEFAULTS.scanIntervalMs;
  chrome.storage.local.get(WMC_DEFAULTS, (cfg) => {
    base = cfg.scanIntervalMs || base;
  });

  // Irregular cadence (self-rescheduling) so activity isn't clockwork.
  const loop = async () => {
    try {
      await WMC_ENGINE.runCycle();
    } catch (_) {}
    const next = base * (0.6 + Math.random() * 1.2); // ~0.6×–1.8× the base
    setTimeout(loop, next);
  };
  setTimeout(loop, 1500 + Math.random() * 3000); // small random warm-up delay

  // Endgame sniper loop — with anti-snipe, auctions are decided in their final
  // seconds, so we bid only when an eligible auction enters the ~[12–22 s] window
  // (see engine). Needs a fast timer + the tab open; a background service-worker
  // alarm (min 1 min) can't hit a ~10 s window, so nothing is sniped tab-closed.
  const snipeLoop = async () => {
    try {
      await WMC_ENGINE.snipeEndgame();
    } catch (_) {}
    setTimeout(snipeLoop, 5000 + Math.random() * 3000); // ~5–8 s
  };
  setTimeout(snipeLoop, 4000 + Math.random() * 3000);
})();
