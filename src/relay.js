// Bridges the MAIN-world sniffer to the isolated world: persists learned
// endpoints and notifies the service worker the first time each is seen.

window.addEventListener("message", async (ev) => {
  if (ev.source !== window || ev.data?.source !== "wmc-sniffer") return;
  const { name, url, method, bodyKeys, body } = ev.data;
  const route = new URL(url, location.origin).pathname;

  const existing = await WMC_DB.getEndpoint(name);
  await WMC_DB.saveEndpoint(name, { route, method, bodyKeys, sample: body, learnedAt: Date.now() });

  if (!existing) {
    wmcSend({ type: "endpoint:learned", name, route, method, bodyKeys });
  }
});
