// Construit le vocabulaire de matching par étiquette. Source : rimessolides.com
// (champ lexical d'un mot), fetché par le SERVICE WORKER (CORS bloqué en page),
// ∪ les mots du nom de l'étiquette, filtré (mode Prudent), moins les mots retirés
// par l'utilisateur. Mis en cache dans la DB. Content-script.

const WMC_LEXICON = (() => {
  // Extrait les mots des liens <a href="motscles.aspx?m=...">MOT</a> (pur).
  function parseRimes(html) {
    const out = [];
    const re = /<a[^>]+href=["']?motscles\.aspx\?m=[^"'>]*["']?[^>]*>([^<]+)<\/a>/gi;
    let m;
    while ((m = re.exec(html || "")) !== null) {
      const w = m[1].replace(/\s+/g, " ").trim();
      if (w) out.push(w);
    }
    return out;
  }

  // Demande au service worker de fetcher rimessolides (permission d'hôte).
  function fetchRimes(word) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "rimes", word }, (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.ok) return resolve([]);
          resolve(parseRimes(resp.html));
        });
      } catch (_) {
        resolve([]);
      }
    });
  }

  // Vocabulaire d'un tag : cache-first, sinon fetch rimessolides pour chaque mot
  // du nom + union avec les mots du nom, filtré (Prudent), moins `removed`.
  async function buildVocab(tag, cfg) {
    const name = tag && tag.name;
    if (!name) return [];
    const ttl = (cfg && cfg.vocabTtlDays ? cfg.vocabTtlDays : 90) * 24 * 3600 * 1000;
    const cached = typeof WMC_DB !== "undefined" ? await WMC_DB.getVocab(name).catch(() => null) : null;
    if (cached && Date.now() - (cached.fetchedAt || 0) < ttl) {
      return applyFilter(cached.words, cached.removed);
    }
    const nameWords = WMC_INTEREST.nameWords(name);
    const raw = new Set(nameWords);
    for (const seed of nameWords) {
      const rimes = await fetchRimes(seed);
      for (const w of rimes) raw.add(WMC_INTEREST.normalize(w));
    }
    const removed = (cached && cached.removed) || [];
    const words = [...raw];
    if (typeof WMC_DB !== "undefined") await WMC_DB.putVocab({ name, words, removed, fetchedAt: Date.now() });
    return applyFilter(words, removed);
  }

  // Filtre Prudent : ≥4 lettres (les mots du nom passent déjà à ≥3 via nameWords,
  // conservés ici via une seconde chance), pas stopword, pas retiré.
  function applyFilter(words, removed) {
    const rm = new Set((removed || []).map(WMC_INTEREST.normalize));
    return [...new Set((words || []).map(WMC_INTEREST.normalize))]
      .filter((w) => w && !rm.has(w) && (WMC_INTEREST.matchable(w) || WMC_INTEREST.matchable(w, 3)));
  }

  async function removeWord(name, word) {
    if (typeof WMC_DB === "undefined") return;
    const row = (await WMC_DB.getVocab(name).catch(() => null)) || { name, words: [], removed: [] };
    const w = WMC_INTEREST.normalize(word);
    if (!row.removed.includes(w)) row.removed.push(w);
    await WMC_DB.putVocab(row);
  }

  return { parseRimes, fetchRimes, buildVocab, removeWord, applyFilter };
})();

if (typeof module !== "undefined" && module.exports) module.exports = WMC_LEXICON;
