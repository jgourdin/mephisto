// Le popup n'expose qu'un sous-ensemble des réglages (le dashboard a le reste),
// mais les valeurs par défaut viennent de WMC_DEFAULTS : une seule source, sinon
// popup et dashboard proposent des défauts différents pour la même clé.
const POPUP_KEYS = ["enabled", "dryRun", "autoOpen", "autoBid", "maxBidWb", "dailySpendCapWb", "autoSell", "sellStartWb", "myUsername"];
const DEFAULTS = Object.fromEntries(POPUP_KEYS.map((k) => [k, WMC_DEFAULTS[k]]));

// Aide par champ : un badge « ? » ajouté au <label> de chaque input connu, plutôt
// que 9 badges écrits à la main dans le HTML.
for (const [key, text] of Object.entries(WMC_HELP)) {
  const label = document.getElementById(key)?.parentElement;
  if (!label || label.tagName !== "LABEL") continue;
  const badge = document.createElement("span");
  badge.className = "help";
  badge.textContent = "?";
  const tip = document.createElement("span");
  tip.className = "tip";
  tip.textContent = text;
  badge.appendChild(tip);
  // Le badge est DANS le <label> : sans preventDefault le clic serait reforwardé
  // à l'input et cocherait la case.
  badge.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const wasOpen = tip.classList.contains("open");
    document.querySelectorAll(".tip.open").forEach((t) => t.classList.remove("open"));
    if (!wasOpen) tip.classList.add("open");
  });
  label.insertBefore(badge, label.lastElementChild);
}
document.addEventListener("click", () => {
  document.querySelectorAll(".tip.open").forEach((t) => t.classList.remove("open"));
});

chrome.storage.local.get(DEFAULTS, (cfg) => {
  for (const key of Object.keys(DEFAULTS)) {
    const input = document.getElementById(key);
    if (!input) continue;
    if (input.type === "checkbox") input.checked = cfg[key];
    else input.value = cfg[key];

    input.addEventListener("change", () => {
      // Block going live (dry-run OFF) without a pseudo.
      if (key === "dryRun" && input.checked === false) {
        const pseudo = (document.getElementById("myUsername")?.value || "").trim();
        if (!pseudo) {
          input.checked = true;
          alert("Renseigne ton pseudo avant de désactiver le dry-run.");
          return;
        }
      }
      const value =
        input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value;
      chrome.storage.local.set({ [key]: value });
    });
  }
});

document.getElementById("openDashboard").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "dashboard:toggle" });
  window.close();
});
