// HieloIce - service worker for Web Push notifications only.
// No offline caching / no interception of fetch requests.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Distinct vibration pattern for chat messages so they feel different from
// other push types (offers, flash sales, new products, reminders) even
// though the Web Push API does not let us attach a custom sound file to a
// system notification - vibration + a foreground "ping" sound (played by the
// open tab, see the "push" postMessage below) are the closest we can get.
const VIBRATE_PATTERNS = {
  message: [80, 40, 80, 40, 160],
  default: [120],
};

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const type = data.type || "default";
  const title = data.title || "HieloIce";
  const options = {
    body: data.body || "",
    icon: "/icon.png",
    badge: "/icon.png",
    vibrate: VIBRATE_PATTERNS[type] || VIBRATE_PATTERNS.default,
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || "/", type },
  };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // Let any open tab know a push arrived so it can play a distinct sound
      // itself while the app is in the foreground (system notifications are
      // silenced by the OS/browser while the tab has focus).
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
        clientList.forEach((client) => client.postMessage({ kind: "push-received", type, title, body: data.body || "" }));
      }),
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          if ("navigate" in client) client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
