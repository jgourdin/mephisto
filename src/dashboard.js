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
    #wmc-panel button#wmc-export-target{margin-top:6px;width:100%;padding:6px;border:none;border-radius:8px;
      background:#4c1d95;color:#e5e7eb;font:12px system-ui,sans-serif;cursor:pointer}
    #wmc-panel .kws{padding:2px 0 8px}
    #wmc-panel .kw{display:inline-block;margin:1px;padding:0 5px;border-radius:6px;background:#1e293b;color:#94a3b8;font-size:11px;cursor:pointer}
    #wmc-panel .kw:hover{background:#7f1d1d;color:#fecaca}
    #wmc-panel .kw-add{width:100%;margin-top:3px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e5e7eb;font-size:11px;padding:2px 6px}
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
    { k: "maxBidInterestWb", label: "Mise max centres d'intérêt (WB)", num: true },
    { k: "maxBidLWb", label: "Mise max L (WB)", num: true },
    { k: "maxBidUrWb", label: "Mise max UR (WB)", num: true },
    { k: "maxBidSrWb", label: "Mise max SR (WB)", num: true },
    { k: "maxBidWb", label: "Mise max par défaut (WB)", num: true },
    { k: "buyValueRatio", label: "Ratio achat ÷ valeur", num: true },
    { k: "dailySpendCapWb", label: "Plafond dépense/jour", num: true },
    { k: "autoSell", label: "Auto-sell (flip)" },
    { k: "sellAbTest", label: "Test A/B vente" },
    { k: "sellStartWb", label: "Prix de vente (WB)", num: true },
    { k: "targetPlayer", label: "Cibles (virgules)", text: true },
    { k: "interestWatch", label: "Repérage marché (thèmes)" },
    { k: "interestAutoBid", label: "Auto-bid prioritaire (thèmes)" },
    { k: "interestAutoTag", label: "Auto-étiquetage (thèmes)" },
    { k: "interestProtectSell", label: "Protéger le on-theme (vente)" },
    { k: "interestBidBonus", label: "Bonus mise on-theme (WB)", num: true },
    { k: "interestDepthTag", label: "Profondeur auto-tag (3 = précis)", num: true },
    { k: "interestDepthMarket", label: "Profondeur marché (4 = rappel)", num: true },
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

    const exportBtn = p.querySelector("#wmc-export-target");
    if (exportBtn)
      exportBtn.addEventListener("click", async () => {
        const target = (p.querySelector('[data-k="targetPlayer"]')?.value || "").trim();
        if (!target) return wmcToast("Cible", "Renseigne d'abord au moins un pseudo à surveiller.");
        const data = await WMC_DB.exportTarget(); // all watched players
        if (!data.length) return wmcToast("Cible", "Aucune action loggée (laisse tourner un peu).");
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "mephisto-targets.json";
        a.click();
        URL.revokeObjectURL(url);
        wmcToast("Export", `${data.length} action(s) exportée(s).`);
      });

    p.querySelectorAll(".kw").forEach((chip) =>
      chip.addEventListener("click", async () => {
        await WMC_ANCESTRY.removeRoot(chip.dataset.tag, chip.dataset.r);
        if (typeof WMC_ENGINE !== "undefined" && WMC_ENGINE.invalidateInterest) WMC_ENGINE.invalidateInterest();
        chip.remove();
        wmcToast("Racines", `« ${chip.dataset.r} » retirée de « ${chip.dataset.tag} ».`);
      })
    );
    p.querySelectorAll(".kw-add").forEach((input) =>
      input.addEventListener("keydown", async (ev) => {
        if (ev.key !== "Enter" || !input.value.trim()) return;
        await WMC_ANCESTRY.addRoot(input.dataset.tag, input.value.trim());
        if (typeof WMC_ENGINE !== "undefined" && WMC_ENGINE.invalidateInterest) WMC_ENGINE.invalidateInterest();
        wmcToast("Racines", `« ${input.value.trim()} » ajoutée à « ${input.dataset.tag} ».`);
        input.value = "";
      })
    );
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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
    const targetName = (cfg.targetPlayer || "").trim();
    const targetCount = targetName ? await WMC_DB.targetCount().catch(() => 0) : 0;
    const abStats = cfg.sellAbTest ? await WMC_DB.sellAbStats().catch(() => ({})) : null;
    const metaAll = (await WMC_DB.allCardMeta().catch(() => [])).filter((m) => m.score != null);
    const metaTop = metaAll.slice().sort((a, b) => b.score - a.score).slice(0, 10);
    const urVal = (score) =>
      typeof WMC_VALUE !== "undefined" && WMC_VALUE.UR_BY_SCORE ? WMC_VALUE.UR_BY_SCORE[score] ?? "—" : "—";
    const cards = owned.cards || [];
    // Journal des actions de l'IA — l'historique visuel de ce que Méphisto a fait.
    const ACTION_ICON = { pack: "📦", bid: "🎯", sell: "💰", tag: "🏷️", protect: "🛡️", watch: "👀" };
    const actionRows = (await WMC_DB.recentActions(25).catch(() => []))
      .map((a) => {
        const d = new Date(a.at || 0);
        const pad = (n) => String(n).padStart(2, "0");
        return `<tr><td>${ACTION_ICON[a.type] || "•"} ${esc(a.text || a.type)}</td>
          <td class="r muted">${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}</td></tr>`;
      })
      .join("");

    let themeSection = "";
    if (typeof WMC_TAGSYNC !== "undefined" && typeof WMC_ANCESTRY !== "undefined" && typeof WMC_INTEREST !== "undefined") {
      const tags = await WMC_TAGSYNC.listTags().catch(() => []);
      const metaByTitle = {};
      for (const m of await WMC_DB.allCardMeta().catch(() => [])) metaByTitle[m.title] = m;
      const parents = await WMC_ANCESTRY.parentsMap();
      const rootsByName = {};
      const rootsByTag = [];
      for (const t of tags) {
        const roots = await WMC_ANCESTRY.rootsFor(t.name, cfg).catch(() => []);
        rootsByName[t.id] = { name: t.name, color: t.color, roots };
        rootsByTag.push({ tagId: t.id, roots });
      }
      const counts = {};
      for (const c of cards) {
        const meta = metaByTitle[c.wikipedia_title] || null;
        const cats = meta && Array.isArray(meta.categories) ? meta.categories : [];
        for (const id of Object.keys(WMC_INTEREST.walkAncestry(cats, rootsByTag, parents, cfg.interestDepthTag ?? 3)))
          counts[id] = (counts[id] || 0) + 1;
      }
      themeSection = tags
        .map((t) => {
          const info = rootsByName[t.id];
          const safeColor = /^#[0-9a-f]{6}$/i.test(t.color || "") ? t.color : "#334155";
          const chips = info.roots
            .map((r) => `<span class="kw" data-tag="${esc(t.name)}" data-r="${esc(r)}" title="Cliquer pour retirer cette racine">${esc(r)}×</span>`)
            .join(" ");
          return `<tr><td><span class="pill" style="background:${safeColor}22;color:${safeColor}">${esc(t.name)}</span></td><td class="r">${counts[t.id] || 0}</td></tr>
                  <tr><td colspan="2" class="kws">${chips || '<span class="muted">racines en cours de résolution…</span>'}
                    <input type="text" class="kw-add" data-tag="${esc(t.name)}" placeholder="+ racine (nom de catégorie)"></td></tr>`;
        })
        .join("");
    }
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

      <h3>Désirabilité geek/FR — ${metaAll.length} évaluée(s)</h3>
      <table>${
        metaTop.length
          ? metaTop
              .map(
                (m) =>
                  `<tr><td>${esc(m.title)}</td><td class="r"><span class="pill">${m.score}/6</span></td>
        <td class="r">${urVal(m.score)} WB</td>
        <td class="r muted">${m.langCount}🌐 ${m.backlinks}🔗${m.spikeRatio != null ? ` ·${m.spikeRatio}×` : ""}</td></tr>`
              )
              .join("")
          : `<tr><td class="muted" colspan="4">Pas encore d'évaluations (laisse tourner quelques cycles).</td></tr>`
      }</table>
      <p class="muted">Score = notoriété (langues) + ancrage (liens) + intérêt durable (anti-pic). Pilote achat & prix de vente.</p>

      <h3>Cible surveillée</h3>
      <p class="muted">${targetName ? `${esc(targetName)} — ${targetCount} action(s) loggée(s)` : "Renseigne un pseudo dans « Cible » ci-dessus."}</p>
      <button id="wmc-export-target">Exporter JSON</button>

      ${
        abStats
          ? `<h3>Test A/B vente</h3>
      <table>
        <tr><td class="muted">Strat.</td><td class="r muted">vendus/réglés</td><td class="r muted">taux</td><td class="r muted">WB/listing</td></tr>
        ${
          Object.keys(abStats).length
            ? Object.entries(abStats)
                .map(
                  ([s, v]) =>
                    `<tr><td>${s === "A" ? "Ancienne" : "Nouvelle"} (${s})</td><td class="r">${v.sold}/${v.settled}</td><td class="r">${v.sellThroughPct ?? "—"}%</td><td class="r">${v.wbPerListing ?? "—"}</td></tr>`
                )
                .join("")
            : `<tr><td class="muted" colspan="4">Pas encore de données (les ventes doivent se régler).</td></tr>`
        }
      </table>`
          : ""
      }

      <h3>Journal de l'IA</h3>
      <table>${actionRows || `<tr><td class="muted">Aucune action enregistrée pour l'instant.</td></tr>`}</table>
      <p class="muted">Les 25 dernières actions de Méphisto : mises 🎯, ventes 💰, paquets 📦, étiquettes 🏷️, protections 🛡️, repérages 👀.</p>

      <h3>Tes thèmes</h3>
      <table>${themeSection || `<tr><td class="muted" colspan="2">Aucune étiquette (ou session absente).</td></tr>`}</table>
      <p class="muted">Comptes = cartes dont une catégorie Wikipédia descend d'une racine (profondeur ${cfg.interestDepthTag ?? 3}). Clique une racine pour la retirer, Entrée pour en ajouter.</p>

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
