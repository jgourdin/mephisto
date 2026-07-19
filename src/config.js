// Shared config + guardrails. Everything is off by default: features are
// opt-in from the popup, and stored in chrome.storage.local.
const WMC_DEFAULTS = {
  // Master switch: when false, no automation runs at all (observation only).
  enabled: false,

  // --- Auto-open packs ---
  autoOpen: false, // open packs automatically via the API
  autoOpenMinStock: 1, // open whenever at least this many packs are available (1 = drain to 0)

  // Dry-run: automation logs what it WOULD do (bid/gift) without doing it.
  // Best way to validate config safely before going live.
  dryRun: true,

  // --- Auto-bid (marketplace) ---
  marketWatch: false, // highlight + notify deals (page overlay only)
  autoBid: false, // place capped bids automatically
  bidStrategy: "defend", // "defend" = re-bid up to maxBidWb to keep the lead (wins);
  //                          "cheap"  = old behaviour (one bid on cheapest, no re-bid)
  myUsername: "", // your game pseudo — set it in the popup; never outbid yourself / bid on your own listings
  targetRarities: ["SR", "UR", "L"], // NEVER buy below Super Rare
  maxBidWb: 20, // plafond de mise PAR DÉFAUT — filet pour R/PC/C (marché: quelques WB)
  maxBidLWb: 500, // plafond L — marché médian ~2000, on ne rafle que les L bradées
  maxBidUrWb: 150, // plafond UR — attrape les UR pas chères/moyennes (budget 1650)
  maxBidSrWb: 40, // plafond SR — couvre la masse 10-50 WB
  buyValueRatio: 0.6, // value-based bidding: pay at most (estimated value × this). Bid up to min(value×ratio, plafond de la carte)
  dailySpendCapWb: 1500, // plafond de dépense/jour — DOIT être ≥ au plus gros plafond par carte (L=500) ; ~90% du bankroll, laisse la marge pour enchaîner plusieurs bonnes affaires
  bidCooldownMs: 20_000, // min delay between two automated bids
  dealMedianRatio: 0.7, // advisory "steal" flag when priced under this × rarity median

  // --- Auto-sell (flip: relist owned cards higher to make WB) ---
  autoSell: false,
  sellRarities: ["SR", "UR"], // flip UR/SR only — Legendaries are keepers, never auto-sold
  sellStartWb: 5, // LOW starting base on purpose (SR/commons): a low base attracts bidders who war
  //                 the price up; a high base sits unsold (market data: bid-getters start ~10, dead ~99)
  sellUrFloorWb: 25, // UR/L base floor for OBSCURE/un-enriched cards (desirability score 0-1).
  sellUrFloorMidWb: 40, // UR/L base floor for mid desirability (score 2-3).
  sellUrFloorHighWb: 80, // UR/L base floor for high desirability (score 4+) — desirable cards start
  //                        higher (they get bid up anyway); the auction finds the premium above it.
  //                        Floor scales with DESIRABILITY (langs/backlinks/steadiness), NOT pageviews:
  //                        an obscure 26k-view UR cleared at 10 while a French icon reached ~600.
  enrichPerCycle: 3, // max Wikipedia signal fetches per cycle (gentle on the API; cached ~monthly)
  sellDurationMin: 10, // auction duration for SR listings (minutes) — they clear cheap fast
  sellDurationUrMin: 30, // UR a bit longer than SR to catch buyers, but short enough for fast turnover
  sellSlotMax: 5, // don't exceed the active-sell limit (5 free / 10 PRO)
  sellSkipStarred: true, // never auto-sell favourites — star a card to keep it
  sellAbTest: false, // split each listing 50/50 old (random, 10-min) vs new (stat-priority, UR longer) + track outcomes

  // --- Guild wishlist ---
  guildWatch: false, // notify when you can gift a wishlist card
  autoGift: false, // auto-gift the top match once/day (uses learned endpoint)
  spareGuildmates: true, // never bid on a guildmate's listing, and never outbid a guildmate

  // --- Target watch (log players' market moves for export/analysis) ---
  targetPlayer: "", // username(s) to monitor, comma/space-separated; empty = off

  // --- Interest targeting (ciblage par thèmes, dynamique par utilisateur) ---
  interestWatch: false, // surligne/notifie au marché les cartes on-theme
  interestAutoBid: false, // priorité auto-bid on-theme (dans les plafonds)
  interestAutoTag: false, // auto-étiquette les cartes possédées (respecte dryRun)
  interestProtectSell: true, // ne jamais auto-vendre/défausser une carte on-theme
  interestBidBonus: 40, // WB ajoutés à la valeur estimée d'une carte on-theme (borné par maxBidInterestWb)
  maxBidInterestWb: 250, // plafond dédié centres d'intérêt (toutes raretés) — > plafonds normaux, ~15% du bankroll max/carte
  interestDepthTag: 3, // profondeur d'ascendance pour l'auto-tag (précision — banc: P86/R72)
  interestDepthMarket: 4, // profondeur pour repérage/auto-bid/protection (rappel — banc: P77/R80)
  ancestryFetchPerCycle: 4, // budget d'appels API "parents de catégories" par cycle (lots de 50)
  rootsTtlDays: 90, // TTL de la résolution des racines de catégorie par étiquette

  // --- Cadence / politeness ---
  tickMinutes: 1, // service-worker alarm period (min 1 min in MV3)
  scanIntervalMs: 45_000, // in-page fallback loop (mobile WebView)
  actionJitterMs: [1_500, 6_000], // random delay before any automated action
};

// Aide par champ, affichée au survol (desktop) ou au tap (Android) du badge ⓘ
// dans le dashboard et le popup. Clé = clé de config, donc une seule source
// pour les deux surfaces. Rédigé pour l'utilisateur : ce que le réglage fait,
// et le repère de marché quand il y en a un (cf. docs/market-value-analysis.md).
const WMC_HELP = {
  enabled:
    "Interrupteur général. Décoché, Méphisto observe et conseille mais n'agit jamais. À cocher pour autoriser toute automatisation.",
  dryRun:
    "Simule les actions (mise, vente, ouverture) et les journalise sans les exécuter. À garder coché tant que ta config n'est pas validée.",

  autoOpen: "Ouvre tes paquets automatiquement dès qu'il y en a en stock.",

  autoBid:
    "Place des enchères automatiques sur le marché, dans la limite des plafonds ci-dessous. Ne vise que les SR et au-dessus.",
  myUsername:
    "Ton pseudo WikiMasters. Sert à ne jamais enchérir sur tes propres ventes ni te surenchérir toi-même. Obligatoire pour sortir du dry-run.",
  maxBidInterestWb:
    "Plafond dédié aux cartes de tes centres d'intérêt, toutes raretés. Plus haut que les plafonds normaux : c'est là que tu acceptes de payer.",
  maxBidLWb:
    "Plafond de mise pour une Légendaire. Le marché médian tourne autour de 2000 WB : ce plafond ne rafle que les L bradées.",
  maxBidUrWb: "Plafond de mise pour une UR. Attrape les UR pas chères à moyennes (marché typique jusqu'à ~1650 WB).",
  maxBidSrWb: "Plafond de mise pour une SR. Couvre la masse du marché SR, qui se joue entre 10 et 50 WB.",
  maxBidWb: "Plafond de mise par défaut, filet de sécurité pour les raretés sans plafond dédié (R, PC, C).",
  buyValueRatio:
    "Fraction de la valeur estimée que tu acceptes de payer. 0.6 = ne jamais miser plus de 60 % de ce que la carte vaut. La mise retenue est le minimum entre ça et le plafond de la carte.",
  dailySpendCapWb:
    "Total maximum dépensé en enchères sur une journée. Doit rester supérieur au plus gros plafond par carte, sinon une seule grosse enchère bloque la journée.",

  autoSell: "Remet en vente automatiquement tes cartes SR/UR (hors favoris ★) pour faire des WB.",
  sellStartWb:
    "Prix de départ des mises en vente. Volontairement bas : une base basse attire les enchérisseurs qui font monter le prix, une base haute reste invendue.",
  sellAbTest: "Répartit tes ventes 50/50 entre l'ancienne et la nouvelle stratégie de prix, et compare les résultats.",

  targetPlayer:
    "Pseudos de joueurs à surveiller, séparés par des virgules. Leurs mouvements de marché sont journalisés pour analyse. Vide = désactivé.",

  interestWatch: "Surligne et notifie au marché les cartes qui correspondent à tes étiquettes de centres d'intérêt.",
  interestAutoBid: "Donne la priorité aux cartes on-theme lors des enchères automatiques, dans la limite des plafonds.",
  interestAutoTag: "Étiquette automatiquement les cartes que tu possèdes selon tes centres d'intérêt. Respecte le dry-run.",
  interestProtectSell: "Ne jamais mettre en vente ni défausser une carte qui correspond à tes centres d'intérêt.",
  interestBidBonus:
    "WB ajoutés à la valeur estimée d'une carte on-theme, pour la remporter plus souvent. Reste borné par le plafond centres d'intérêt.",
  interestDepthTag:
    "Jusqu'où remonter le graphe des catégories Wikipédia pour l'auto-étiquetage. Plus bas = plus précis, moins de cartes étiquetées à tort. 3 est le réglage calibré.",
  interestDepthMarket:
    "Même profondeur, mais pour le repérage au marché. Plus haut = plus de cartes repérées, au prix de quelques faux positifs. 4 est le réglage calibré.",
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

// Surface a message to the user. The engine runs in the page (content script
// on desktop, WebView on mobile), so we use whatever that context offers:
//   - Android WebView: chrome.notifications is shimmed to a native notif.
//   - Desktop content script: chrome.notifications isn't available, so we show
//     an in-page toast (the user is on the tab anyway while it runs).
function wmcNotify(title, message) {
  try {
    if (typeof chrome !== "undefined" && chrome.notifications && chrome.notifications.create) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title,
        message,
      });
      return;
    }
  } catch (_) {
    /* fall through to toast */
  }
  wmcToast(title, message);
}

// Minimal in-page toast (bottom-center), auto-dismiss. No-op without a DOM.
function wmcToast(title, message) {
  try {
    if (typeof document === "undefined" || !document.body) return;
    const el = document.createElement("div");
    el.textContent = `${title.startsWith("😈") ? "" : "😈 "}${title} — ${message}`;
    el.style.cssText =
      "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483001;" +
      "max-width:90vw;background:#0b1020;color:#e5e7eb;border:1px solid #4c1d95;border-radius:10px;" +
      "padding:10px 14px;font:13px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.5)";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4500);
  } catch (_) {
    /* ignore */
  }
}

if (typeof module !== "undefined") module.exports = { WMC_DEFAULTS, WMC_HELP, WMC_RARITY_ORDER };
