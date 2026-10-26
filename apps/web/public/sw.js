// GhostCart service worker: shows sellers' approval notifications and opens the offer when tapped.
self.addEventListener("push", (event) => {
  let msg = { title: "GhostCart", body: "An offer needs your decision.", url: "/seller" };
  try {
    msg = { ...msg, ...event.data.json() };
  } catch {}
  event.waitUntil(self.registration.showNotification(msg.title, { body: msg.body, tag: msg.tag, data: { url: msg.url }, icon: "/favicon.ico", requireInteraction: true }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? "/seller", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => w.url.startsWith(self.location.origin + "/seller"));
      if (open) return open.navigate(url).then((w) => w && w.focus());
      return self.clients.openWindow(url);
    }),
  );
});
