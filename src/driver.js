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
})();
