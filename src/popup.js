const DEFAULTS = {
  enabled: false,
  dryRun: true,
  packTimer: true,
  autoOpen: false,
  marketWatch: false,
  autoBid: false,
  maxBidWb: 30,
  dailySpendCapWb: 150,
  guildWatch: false,
  autoGift: false,
  myUsername: "",
};

chrome.storage.local.get(DEFAULTS, (cfg) => {
  for (const key of Object.keys(DEFAULTS)) {
    const input = document.getElementById(key);
    if (!input) continue;
    if (input.type === "checkbox") input.checked = cfg[key];
    else input.value = cfg[key];

    input.addEventListener("change", () => {
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
