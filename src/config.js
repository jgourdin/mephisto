// Shared config + guardrails. Everything is off by default: features are
// opt-in from the popup, and stored in chrome.storage.local.
const WMC_DEFAULTS = {
  // Master switch: when false, no automation runs at all (observation only).
  enabled: false,

  // --- Pack timer / auto-open (page /pulls) ---
  packTimer: true, // badge + notification when stock is close to full
  packNotifyAt: 8, // notify when stock >= N (regen stops at 10 = waste)
  autoOpen: false, // open packs automatically while the /pulls tab is open
  autoOpenMinStock: 1, // open whenever at least this many packs are available (1 = drain to 0)

  // Dry-run: automation logs what it WOULD do (bid/gift) without doing it.
  // Best way to validate config safely before going live.
  dryRun: true,

  // --- Marketplace watch / auto-bid (page /marketplace) ---
  marketWatch: false, // highlight + notify deals, no action
  autoBid: false, // place capped bids automatically while the tab is open
  myUsername: "", // your game pseudo — set it in the popup; used to never outbid yourself / bid on your own listings
  targetRarities: ["SR", "UR", "L"],
  maxBidWb: 30, // never bid above this per auction
  dailySpendCapWb: 150, // hard cap of WB committed by auto-bid per day (UTC)
  bidCooldownMs: 90_000, // at most one automated bid per this window
  dealMedianRatio: 0.7, // only a "deal" if next bid <= this × rarity median (when history exists)

  // --- Guild wishlist (page-independent, polled on any tab) ---
  guildWatch: false, // notify when you can gift a wishlist card
  autoGift: false, // auto-gift the top match once/day (uses learned endpoint)

  // --- Politeness / anti-hammering ---
  // Scans are DOM reads on the open tab only; no background API polling.
  scanIntervalMs: 45_000,
  // Random extra delay before any automated click, to keep a human cadence.
  actionJitterMs: [1_500, 6_000],
};

// Rarity sort order, highest first (used to prioritize deals).
const WMC_RARITY_ORDER = ["L", "UR", "SR", "R", "PC", "C"];

// Safe message send: after the extension reloads/updates, a still-running old
// content script loses its context and chrome.runtime.sendMessage throws
// "Extension context invalidated". Guard + swallow so we don't spam errors.
function wmcSend(message) {
  try {
    if (chrome.runtime?.id) chrome.runtime.sendMessage(message);
  } catch (_) {
    /* context invalidated on reload — ignore */
  }
}
