// Service worker: fait tourner le moteur toutes les minutes, même onglet fermé.
if (typeof WMC_DEFAULTS === "undefined" && typeof importScripts === "function") {
  importScripts("config.js", "api.js", "value.js", "engine.js");
}
const WMC_ALARM = "mephisto-tick";
function ensureAlarm() {
  chrome.alarms.get(WMC_ALARM, (a) => { if (!a) chrome.alarms.create(WMC_ALARM, { periodInMinutes: 1 }); });
}
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); WMC_ENGINE.runCycle(); });
ensureAlarm();
chrome.alarms.onAlarm.addListener((a) => { if (a.name === WMC_ALARM) WMC_ENGINE.runCycle(); });
chrome.storage.onChanged.addListener((c, area) => {
  if (area === "local" && c.enabled && c.enabled.newValue === true) WMC_ENGINE.runCycle();
});
// Fetch rimessolides pour le vocabulaire d'étiquette (CORS bloqué en content-script ;
// le SW y a droit via host_permissions). Renvoie le HTML brut au content-script.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "rimes" && msg.word) {
    const url = "https://www.rimessolides.com/motscles.aspx?m=" + encodeURIComponent(msg.word);
    fetch(url)
      .then((r) => (r.ok ? r.text() : ""))
      .then((html) => sendResponse({ ok: !!html, html }))
      .catch(() => sendResponse({ ok: false, html: "" }));
    return true; // réponse asynchrone
  }
});
