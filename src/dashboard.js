// Injected dashboard overlay. Lives in the content script so it can read our
// IndexedDB and call the game API with the page session. A floating button
// toggles a panel; the popup can also toggle it via a runtime message.

(() => {
  const RARITIES = ["L", "UR", "SR", "R", "PC", "C"];
  let root = null;

  const css = `
    #wmc-fab{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:48px;height:48px;border-radius:50%;
      border:none;padding:0;overflow:hidden;background:#4c1d95;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.4)}
    #wmc-fab img{width:100%;height:100%;object-fit:cover;display:block}
    #wmc-panel h2 img{width:22px;height:22px;border-radius:5px;vertical-align:-5px;margin-right:6px}
    #wmc-panel{position:fixed;right:12px;bottom:70px;z-index:2147483000;box-sizing:border-box;
      width:min(340px, calc(100vw - 24px));max-height:75vh;overflow:auto;
      background:#0b1020;color:#e5e7eb;border:1px solid #334155;border-radius:12px;padding:14px;font:13px/1.45 system-ui,sans-serif}
    #wmc-panel h2{font-size:14px;margin:0 0 8px}
    #wmc-panel h3{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#94a3b8;margin:14px 0 6px}
    #wmc-panel table{width:100%;border-collapse:collapse}
    #wmc-panel td{padding:2px 0;border-bottom:1px solid #1e293b}
    #wmc-panel .r{text-align:right}
    #wmc-panel .muted{color:#94a3b8}
    #wmc-panel .pill{display:inline-block;padding:0 6px;border-radius:6px;background:#1e293b;font-size:11px}
    #wmc-panel .ctrls label{display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:12px;border-bottom:1px solid #1e293b;cursor:pointer}
    #wmc-panel .ctrls input[type=number]{width:58px}
    #wmc-panel .ctrls .kill{color:#f87171;font-weight:600}
    #wmc-panel .ctrls .dry{color:#fbbf24;font-weight:600}
    #wmc-panel .tag{color:#a78bfa;font-style:italic;margin:0 0 8px}
  `;

  const iconUrl = chrome.runtime.getURL("icons/icon128.png");

  function ensureRoot() {
    if (root) return root;
    root = document.createElement("div");
    root.attachShadow({ mode: "open" });
    root.shadowRoot.innerHTML = `<style>${css}</style>
      <button id="wmc-fab" title="Méphisto"><img src="${iconUrl}" alt="Méphisto"></button>
      <div id="wmc-panel" style="display:none"></div>`;
    document.body.appendChild(root);
    root.shadowRoot.getElementById("wmc-fab").addEventListener("click", toggle);
    return root;
  }

  const panel = () => root.shadowRoot.getElementById("wmc-panel");

  async function toggle() {
    ensureRoot();
    const p = panel();
    if (p.style.display === "none") {
      p.style.display = "block";
      p.innerHTML = `<h2><img src="${iconUrl}" alt="">Méphisto</h2><p class="muted">Je consulte les registres…</p>`;
      p.innerHTML = await render();
      wireControls(p);
    } else {
      p.style.display = "none";
    }
  }

  // In-panel toggles: read/write chrome.storage.local (shared with the rest of
  // the extension) so you never need the toolbar popup.
  const CONTROLS = [
    { k: "myUsername", label: "Mon pseudo", text: true },
    { k: "enabled", label: "Automation active", cls: "kill" },
    { k: "dryRun", label: "Dry-run (simule)", cls: "dry" },
    { k: "autoOpen", label: "Auto-open paquets" },
    { k: "autoBid", label: "Auto-bid (SR+)" },
    { k: "maxBidWb", label: "Mise max (WB)", num: true },
    { k: "dailySpendCapWb", label: "Plafond dépense/jour", num: true },
    { k: "autoSell", label: "Auto-sell (flip)" },
    { k: "sellStartWb", label: "Prix de vente (WB)", num: true },
  ];

  function controlsHtml(cfg) {
    const rows = CONTROLS.map((c) => {
      const cls = c.cls ? ` class="${c.cls}"` : "";
      let input;
      if (c.text) input = `<input type="text" data-k="${c.k}" value="${esc(cfg[c.k])}" placeholder="ton pseudo">`;
      else if (c.num) input = `<input type="number" min="0" data-k="${c.k}" value="${num0(cfg[c.k])}">`;
      else input = `<input type="checkbox" data-k="${c.k}"${cfg[c.k] ? " checked" : ""}>`;
      return `<label${cls}>${c.label} ${input}</label>`;
    }).join("");
    return `<div class="ctrls">${rows}</div>`;
  }
  const num0 = (n) => (Number.isFinite(n) ? n : 0);

  function wireControls(p) {
    p.querySelectorAll("[data-k]").forEach((input) => {
      input.addEventListener("change", () => {
        // Block going live (dry-run OFF) without a pseudo.
        if (input.dataset.k === "dryRun" && input.checked === false) {
          const pseudo = (p.querySelector('[data-k="myUsername"]')?.value || "").trim();
          if (!pseudo) {
            input.checked = true;
            wmcToast("Pseudo requis", "Renseigne ton pseudo avant de désactiver le dry-run.");
            return;
          }
        }
        let v;
        if (input.type === "checkbox") v = input.checked;
        else if (input.type === "number") v = Number(input.value);
        else v = input.value; // text (e.g. pseudo)
        chrome.storage.local.set({ [input.dataset.k]: v });
      });
    });
  }

  const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  async function render() {
    const cfg = await new Promise((r) => chrome.storage.local.get(WMC_DEFAULTS, r));
    const [bal, guild, owned] = await Promise.all([
      WMC_API.balance().catch(() => null),
      WMC_API.guildHome().catch(() => null),
      WMC_API.ownedCards().catch(() => ({ cards: [] })),
    ]);
    if (bal?.ledger) await WMC_DB.recordLedger(bal.ledger);

    const medians = {};
    for (const r of RARITIES) medians[r] = await WMC_DB.medianPriceByRarity(r);
    const pulls = await WMC_DB.pullStats();
    const cards = owned.cards || [];
    const deck = WMC_ANALYSIS.bestDeck(cards, "tank");
    const attackers = WMC_ANALYSIS.attackRanking(cards, 5);
    const matches = WMC_ANALYSIS.wishlistMatches(guild);
    const dupes = WMC_ANALYSIS.duplicateSuggestions(cards);

    const ledgerToday = (bal?.ledger || []).filter(
      (l) => (l.created_at || "").slice(0, 10) === new Date().toISOString().slice(0, 10)
    );
    const gainedToday = ledgerToday.filter((l) => l.delta > 0).reduce((s, l) => s + l.delta, 0);

    const medianRows = RARITIES.map(
      (r) => `<tr><td><span class="pill">${r}</span></td><td class="r">${medians[r] ?? "—"} WB</td>
        <td class="r muted">n=${pulls.byRarity[r] || 0} tirés</td></tr>`
    ).join("");

    const num = (n) => (Number.isFinite(n) ? n : "—"); // guard against non-numeric API values
    const deckRows = deck
      .map((c) => `<tr><td>${esc(c.wikipedia_title)}</td><td class="r muted">${esc(c.rarity)}</td>
        <td class="r">DEF ${num(c.def)}</td></tr>`)
      .join("");
    const atkRows = attackers
      .map((c) => `<tr><td>${esc(c.wikipedia_title)}</td><td class="r">ATK ${num(c.atk)}</td>
        <td class="r muted">${num(c.threat)}</td></tr>`)
      .join("");
    const matchRows = matches.length
      ? matches
          .map((m) => `<tr><td>${esc(m.title)} <span class="muted">→ ${esc(m.to)}</span></td>
          <td class="r">+${m.points} pts</td></tr>`)
          .join("")
      : `<tr><td class="muted" colspan="2">Rien à offrir maintenant.</td></tr>`;

    const dupeRows = !dupes.available
      ? `<tr><td class="muted" colspan="2">Compteur de copies indisponible.</td></tr>`
      : dupes.cards.length
        ? dupes.cards
            .slice(0, 8)
            .map((c) => `<tr><td>${esc(c.wikipedia_title)} <span class="muted">${esc(c.rarity)}</span></td>
            <td class="r">${c.extra} en trop</td></tr>`)
            .join("")
        : `<tr><td class="muted" colspan="2">Aucun doublon.</td></tr>`;

    return `
      <h2><img src="${iconUrl}" alt="">Méphisto</h2>
      <p class="tag">« Le diable est dans les enchères. »</p>

      <h3>Contrôles</h3>
      ${controlsHtml(cfg)}

      <table>
        <tr><td>Ton trésor</td><td class="r">${bal?.balance ?? "—"} WB</td></tr>
        <tr><td>Amassé aujourd'hui</td><td class="r">+${gainedToday} WB</td></tr>
        <tr><td>Âmes collectionnées</td><td class="r">${cards.length}</td></tr>
        <tr><td>Guilde</td><td class="r">${esc(guild?.guild?.name || "—")} · #${guild?.leaderboard?.rank ?? "—"}</td></tr>
      </table>

      <h3>Âmes à corrompre (wishlist)</h3>
      <table>${matchRows}</table>

      <h3>Doublons à liquider</h3>
      <table>${dupeRows}</table>

      <h3>Le juste prix (médianes)</h3>
      <table>${medianRows}</table>

      <h3>Deck de bataille (max PV)</h3>
      <table>${deckRows}</table>
      <p class="muted">PV de départ ≈ ${deck.reduce((s, c) => s + c.def, 0)}</p>

      <h3>Tes meilleures armes (ATK × obscurité)</h3>
      <table>${atkRows}</table>

      <p class="muted">Pactes observés : ${pulls.total} tirages. Mes prophéties s'affinent avec l'usage.</p>
    `;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "dashboard:toggle") toggle();
  });

  ensureRoot();
})();
