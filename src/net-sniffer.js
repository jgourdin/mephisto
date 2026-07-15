// Runs in the MAIN world (page context) so it can wrap the game's own
// window.fetch. Purpose: LEARN the POST endpoints we haven't verified yet
// (list a card, gift a wishlist card, open a pack) by observing them the
// first time YOU do the action manually. It never initiates requests — it
// only watches — and forwards the route + payload shape to the isolated
// world via window.postMessage.
//
// Why this instead of guessing: endpoints/payloads stay correct even if the
// game changes them, and we avoid firing test actions to discover them.

(() => {
  const ROUTES = [
    { name: "list", test: (u, m) => m === "POST" && /\/api\/marketplace$/.test(u) },
    { name: "listAlt", test: (u, m) => m === "POST" && /\/api\/marketplace\/(list|create|sell)/.test(u) },
    { name: "gift", test: (u, m) => m === "POST" && /\/api\/guilds?\/.*(gift|donate|wishlist)/.test(u) },
    { name: "openPack", test: (u, m) => m === "POST" && /\/api\/(pull|pack|open)/.test(u) },
    { name: "discard", test: (u, m) => m === "POST" && /\/api\/cards?\/.*(discard|scrap)/.test(u) },
  ];

  const orig = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : input?.url ?? "";
      const method = (init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
      const match = ROUTES.find((r) => r.test(url, method));
      if (match) {
        let body = null;
        try {
          body = init?.body ? JSON.parse(init.body) : null;
        } catch {}
        window.postMessage(
          { source: "wmc-sniffer", name: match.name, url, method, bodyKeys: body ? Object.keys(body) : [], body },
          location.origin
        );
      }
    } catch {}
    return orig.apply(this, arguments);
  };
})();
