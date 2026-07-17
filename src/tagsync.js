// Client des étiquettes WikiMasters (base Supabase de l'utilisateur). Lit la
// session dans le cookie supabase-ssr (JAMAIS loggée). Content-script.

const WMC_TAGSYNC = (() => {
  const REF = "cyrxjeppjqsxxjayfrur";
  const BASE = "https://" + REF + ".supabase.co/rest/v1";
  const ANON =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5cnhqZXBwanFzeHhqYXlmcnVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4ODAzMzksImV4cCI6MjA4OTQ1NjMzOX0.BZluyXygNxuQGDPxFX1zG5i-cqp10CVK-8GGtuak4Rg";

  function parseAuthToken(cookieString) {
    const cookies = {};
    (cookieString || "").split("; ").forEach((c) => {
      const i = c.indexOf("=");
      if (i > 0) cookies[c.slice(0, i)] = decodeURIComponent(c.slice(i + 1));
    });
    const keys = Object.keys(cookies).filter((k) => k.includes("-auth-token"));
    if (!keys.length) return null;
    keys.sort((a, b) => {
      const sa = a.match(/\.(\d+)$/), sb = b.match(/\.(\d+)$/);
      return (sa ? +sa[1] : 0) - (sb ? +sb[1] : 0);
    });
    let raw = keys.map((k) => cookies[k]).join("");
    if (raw.startsWith("base64-")) { try { raw = atob(raw.slice(7)); } catch (_) { return null; } }
    let s; try { s = JSON.parse(raw); } catch (_) { return null; }
    if (Array.isArray(s)) s = s[0];
    return s && s.access_token ? s.access_token : null;
  }

  function jwtSub(token) {
    try {
      return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub || null;
    } catch (_) { return null; }
  }

  const auth = () => {
    const token = typeof document !== "undefined" ? parseAuthToken(document.cookie) : null;
    if (!token) return null;
    return { uid: jwtSub(token), headers: { apikey: ANON, authorization: "Bearer " + token, "content-type": "application/json" } };
  };

  async function listTags() {
    const a = auth();
    if (!a || !a.uid) return [];
    return fetch(`${BASE}/tags?select=id,name,color&user_id=eq.${a.uid}&order=name.asc`, { headers: a.headers })
      .then((r) => (r.ok ? r.json() : [])).catch(() => []);
  }

  async function listAssignments() {
    const a = auth();
    if (!a) return new Set();
    const rows = await fetch(`${BASE}/user_card_tags?select=user_card_id,tag_id`, { headers: a.headers })
      .then((r) => (r.ok ? r.json() : [])).catch(() => []);
    return new Set(rows.map((r) => `${r.user_card_id}|${r.tag_id}`));
  }

  async function assignTags(pairs, dryRun) {
    if (!pairs || !pairs.length) return { ok: true, count: 0 };
    if (dryRun) return { ok: true, count: pairs.length };
    const a = auth();
    if (!a) return { ok: false, count: 0 };
    const res = await fetch(`${BASE}/user_card_tags`, {
      method: "POST",
      headers: { ...a.headers, Prefer: "return=minimal,resolution=merge-duplicates" },
      body: JSON.stringify(pairs),
    }).catch(() => null);
    return { ok: !!(res && res.ok), count: res && res.ok ? pairs.length : 0 };
  }

  return { parseAuthToken, jwtSub, listTags, listAssignments, assignTags };
})();

if (typeof module !== "undefined" && module.exports) module.exports = WMC_TAGSYNC;
