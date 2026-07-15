// Generates app/src/main/assets/companion.js for the Android WebView app by
// reusing the SAME logic as the browser extension. We prepend a small shim
// that emulates the slice of chrome.* the content scripts use (storage,
// runtime.sendMessage, notifications) on top of localStorage + a native
// bridge, then concatenate the extension modules verbatim. This keeps the
// game logic single-sourced: the extension stays the source of truth.
//
// Run from anywhere: `node android/tools/build-companion.mjs`

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url)); // .../android/tools
const repo = join(here, "..", ".."); // repo root
const src = join(repo, "src");
const out = join(repo, "android", "app", "src", "main", "assets", "companion.js");

// Extension modules to reuse, in load order. We skip the extension-only bits:
// net-sniffer.js / relay.js (MAIN-world endpoint learning — endpoints are
// known), background.js (service worker — its notifications are handled by the
// shim below) and popup.* (browser UI).
const MODULES = ["config.js", "db.js", "api.js", "analysis.js", "pulls.js", "marketplace.js", "guild.js", "dashboard.js"];

const iconB64 = readFileSync(join(repo, "icons", "icon128.png")).toString("base64");
const iconDataUri = `data:image/png;base64,${iconB64}`;

const shim = `
// --- chrome.* shim (Android WebView) ---
window.chrome = window.chrome || {};
var __wmcKey = "wmc_store";
var __wmcReadAll = function () { try { return JSON.parse(localStorage.getItem(__wmcKey) || "{}"); } catch (e) { return {}; } };
var __wmcWriteAll = function (o) { try { localStorage.setItem(__wmcKey, JSON.stringify(o)); } catch (e) {} };
var __wmcChangeListeners = [];
chrome.storage = {
  local: {
    get: function (defaults, cb) {
      var all = __wmcReadAll(), out = {};
      if (Array.isArray(defaults)) { defaults.forEach(function (k) { if (k in all) out[k] = all[k]; }); }
      else if (defaults && typeof defaults === "object") { out = Object.assign({}, defaults); Object.keys(defaults).forEach(function (k) { if (k in all) out[k] = all[k]; }); }
      else if (typeof defaults === "string") { if (defaults in all) out[defaults] = all[defaults]; }
      else { out = all; }
      cb(out);
    },
    set: function (obj, cb) {
      var all = __wmcReadAll(), changes = {};
      Object.keys(obj).forEach(function (k) { changes[k] = { oldValue: all[k], newValue: obj[k] }; all[k] = obj[k]; });
      __wmcWriteAll(all);
      __wmcChangeListeners.forEach(function (l) { try { l(changes, "local"); } catch (e) {} });
      if (cb) cb();
    },
  },
  onChanged: { addListener: function (l) { __wmcChangeListeners.push(l); } },
};
var __wmcNativeNotify = function (title, body) {
  try { if (window.MephistoNative && window.MephistoNative.notify) window.MephistoNative.notify(String(title), String(body)); } catch (e) {}
};
var __wmcRoute = function (m) {
  if (!m || !m.type) return;
  var t, b;
  switch (m.type) {
    case "pulls:opened": t = "Paquets éventrés"; b = m.count + " paquet(s) ouvert(s), " + m.remaining + " restant(s)."; break;
    case "market:deals": t = "Proies sur le marché"; b = ((m.deals && m.deals.length) || 0) + " affaire(s) repérée(s)."; break;
    case "market:bid": t = "Pacte scellé"; b = m.card + " (" + m.rarity + ") pour " + m.amount + " WB."; break;
    case "market:dryrun": t = "Illusion (dry-run)"; b = "Aurait misé " + m.next + " WB sur " + m.title + "."; break;
    case "guild:match": t = "Une âme à corrompre"; b = "Offre " + m.title + " à " + m.to + " (+" + m.points + " pts)."; break;
    case "guild:gift": t = "Offrande faite"; b = m.title + " → " + m.to + " (+" + m.points + " pts)."; break;
    case "guild:dryrun": t = "Illusion (dry-run)"; b = "Aurait offert " + m.title + " à " + m.to + "."; break;
    default: return; // pulls:state (badge) etc. — irrelevant on mobile
  }
  __wmcNativeNotify(t, b);
};
chrome.runtime = {
  id: "mephisto",
  getURL: function (path) { return path && path.indexOf("icon") >= 0 ? "${iconDataUri}" : ""; },
  sendMessage: function (msg) { __wmcRoute(msg); },
  onMessage: { addListener: function () {} },
};
chrome.notifications = { create: function (opts) { __wmcNativeNotify((opts && opts.title) || "Méphisto", (opts && opts.message) || ""); } };
chrome.alarms = { create: function () {}, onAlarm: { addListener: function () {} } };
// --- end shim ---
`;

const modulesJs = MODULES.map((f) => `\n// ===== ${f} =====\n` + readFileSync(join(src, f), "utf8")).join("\n");

// Guard so re-injection (WebView onPageFinished can fire more than once) is a
// no-op instead of a "const already declared" error.
const bundle = `(function () {
  if (window.__mephistoLoaded) return;
  window.__mephistoLoaded = true;
${shim}
${modulesJs}
})();
`;

// The assets dir isn't tracked by git (companion.js is generated + ignored),
// so it won't exist on a fresh CI checkout — create it before writing.
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bundle);
console.log("Wrote " + out + " (" + bundle.length + " bytes, " + MODULES.length + " modules + shim)");
