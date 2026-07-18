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
