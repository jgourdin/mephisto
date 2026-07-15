// Content script for /pulls: pack stock + regen timer -> badge/notifications,
// opt-in auto-open, and logging of pulled cards for drop-rate stats.
//
// Auto-open goes through the API (POST /api/packs/open, verified 2026-07-15),
// NOT the DOM: clicking "Ouvrir" works, but the card-reveal carousel only
// responds to trusted pointer events a content script can't produce, so it
// would stall on the reveal. The API opens the pack (cards are added
// server-side) and returns { cards:[5], packs_remaining }. After a drain we
// reload so the on-page counter re-syncs with the server.
//
// DOM anchors (see docs/recon.md): stock "N / 10" near "paquets disponibles",
// "Prochain dans m:ss".

(async () => {
  const cfg = await new Promise((r) => chrome.storage.local.get(WMC_DEFAULTS, r));
  chrome.storage.onChanged.addListener((changes) => {
    for (const [key, { newValue }] of Object.entries(changes)) cfg[key] = newValue;
  });

  const onPullsPage = () => location.pathname.startsWith("/pulls");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = () => {
    const [min, max] = cfg.actionJitterMs;
    return min + Math.random() * (max - min);
  };

  function readStock() {
    const label = [...document.querySelectorAll("*")].find(
      (el) => el.childElementCount === 0 && /paquets disponibles/i.test(el.textContent)
    );
    if (!label) return null;
    const box = label.parentElement?.textContent || "";
    const counter = box.match(/(\d+)\s*\/\s*(\d+)/);
    if (!counter) return null;
    const next = box.match(/Prochain dans\s+(\d+):(\d+)/);
    return {
      stock: Number(counter[1]),
      max: Number(counter[2]),
      nextInSec: next ? Number(next[1]) * 60 + Number(next[2]) : null,
    };
  }

  // Server truth, learned from open responses — the DOM counter goes stale
  // once we open via API, so we don't trust it for the gate.
  let opening = false;
  let serverRemaining = null; // null = unknown (use DOM estimate once)
  let nextRegenAt = 0;

  async function autoOpenDrain(domStock) {
    if (opening) return;
    const believed = serverRemaining ?? domStock ?? 0;
    // Nothing to open and regen not due yet → skip (avoids spamming 403s).
    if (believed < cfg.autoOpenMinStock && Date.now() < nextRegenAt) return;

    opening = true;
    try {
      let opened = 0;
      while (opened < 15) {
        await sleep(jitter());
        const res = await WMC_API.post("/api/packs/open", {});
        if (res.status === 403) {
          serverRemaining = 0;
          nextRegenAt = Date.parse(res.data?.next_regen_at) || Date.now() + 600_000;
          break;
        }
        if (!res.ok || !res.data?.cards) break;
        for (const c of res.data.cards) await WMC_DB.recordPull(c, Date.now());
        serverRemaining = res.data.packs_remaining ?? 0;
        opened++;
        if (serverRemaining < cfg.autoOpenMinStock) break;
      }
      if (opened) {
        wmcSend({ type: "pulls:opened", count: opened, remaining: serverRemaining });
        // API opens don't update the page's React state; reload to resync the
        // on-page counter with the server and stop re-triggering on stale data.
        location.reload();
      }
    } finally {
      opening = false;
    }
  }

  async function tick() {
    if (!onPullsPage()) return;
    const state = readStock();
    if (!state) return;

    wmcSend({ type: "pulls:state", state });

    if (cfg.enabled && cfg.autoOpen) await autoOpenDrain(state.stock);
  }

  setInterval(tick, WMC_DEFAULTS.scanIntervalMs);
  tick();
})();
