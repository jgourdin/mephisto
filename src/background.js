// MV3 service worker: badge, notifications, and daily counters.
// All signal comes from content scripts (open tabs); the worker itself
// never calls the game's API.

const state = { stock: null, max: 10, notifiedFull: false };

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "pulls:state") return onPullsState(msg.state);
  if (msg.type === "market:deals") return onMarketDeals(msg.deals);
  if (msg.type === "market:bid")
    return notify("Pacte scellé", `${msg.card} (${msg.rarity}) pour ${msg.amount} WB. Remboursé si un autre te la vole.`);
  if (msg.type === "market:dryrun")
    return notify("Illusion (dry-run)", `J'aurais raflé ${msg.title} (${msg.rarity}) pour ${msg.next} WB. Une autre fois.`);
  if (msg.type === "guild:match")
    return notify("Une âme à corrompre", `Offre ${msg.title} (${msg.rarity}) à ${msg.to} → +${msg.points} pts. La générosité paie. Toi.`);
  if (msg.type === "guild:gift")
    return notify("Offrande faite", `${msg.title} sacrifiée à ${msg.to}. +${msg.points} pts pour la guilde.`);
  if (msg.type === "guild:dryrun")
    return notify("Illusion (dry-run)", `J'aurais offert ${msg.title} à ${msg.to} (+${msg.points} pts).`);
  if (msg.type === "pulls:opened")
    return notify("Paquets éventrés", `${msg.count} paquet(s) ouvert(s), ${msg.remaining} restant(s). Les âmes affluent.`);
  if (msg.type === "endpoint:learned")
    return notify("Le pacte s'étend", `J'ai appris ${msg.name} (${msg.method} ${msg.route}). Un pouvoir de plus.`);
});

async function onPullsState({ stock, max, nextInSec }) {
  state.stock = stock;
  state.max = max;

  chrome.action.setBadgeText({ text: `${stock}` });
  chrome.action.setBadgeBackgroundColor({
    color: stock >= max ? "#dc2626" : stock >= max - 2 ? "#f59e0b" : "#16a34a",
  });

  const { packTimer, packNotifyAt } = await chrome.storage.local.get({
    packTimer: true,
    packNotifyAt: 8,
  });

  if (packTimer && stock >= packNotifyAt && !state.notifiedFull) {
    state.notifiedFull = true;
    notify(
      "Tes paquets pourrissent",
      `${stock}/${max} — la régénération va s'arrêter. Ouvre-les, mortel, ou gâche tout.`
    );
  }
  if (stock < packNotifyAt) state.notifiedFull = false;

  // Schedule a wake-up around the time the stock should be full, so the
  // notification also fires when the tab was closed in between.
  if (nextInSec != null && stock < max) {
    const minutesUntilFull = (nextInSec + (max - stock - 1) * 600) / 60;
    chrome.alarms.create("stock-full", { delayInMinutes: Math.max(1, minutesUntilFull) });
  }
}

function onMarketDeals(deals) {
  const best = deals[0];
  notify(
    `${deals.length} proie(s) sur le marché`,
    `La meilleure : ${best.rarity} à ${best.bidWb} WB. Les autres dorment — pas toi.`
  );
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "stock-full") {
    notify("10/10. Quel gâchis.", "Le stock est plein, la régénération est morte. J'espère que ça valait la peine.");
  }
});

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title,
    message,
  });
}
