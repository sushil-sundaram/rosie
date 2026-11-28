"use strict";

const SHELL_CACHE = "rosie-shell-v1";
const API_CACHE = "rosie-api-v1";

const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/app.css",
  "/theme.js",
  "/app.js",
  "/manifest.webmanifest",
  "/icon.svg",
  "/js/api.js",
  "/js/dom.js",
  "/js/dates.js",
  "/js/money.js",
  "/js/theme.js",
  "/js/sync.js",
  "/js/router.js",
  "/js/shortcuts.js",
  "/js/store.js",
  "/js/jobs.js",
  "/js/pantry_match.js",
  "/js/components/calendar.js",
  "/js/components/domain.js",
  "/js/components/quick_add.js",
  "/js/views/home.js",
  "/js/views/pantry.js",
  "/js/views/meals.js",
  "/js/views/recipes.js",
  "/js/views/groceries.js",
  "/js/views/chores.js",
  "/js/views/expenses.js",
  "/js/views/settings.js",
];

const CACHEABLE_API_PREFIXES = [
  "/api/pantry",
  "/api/recipes",
  "/api/settings",
  "/api/chores",
  "/api/budgets",
  "/api/meals",
  "/api/expenses",
  "/api/groceries",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== API_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    if (!CACHEABLE_API_PREFIXES.some((p) => url.pathname.startsWith(p))) return;
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.status === 401) {
            caches.delete(API_CACHE).catch(() => {});
          } else if (res.ok) {
            const copy = res.clone();
            caches.open(API_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const hit = await caches.match(req);
          if (hit) return hit;
          return new Response(JSON.stringify({ error: "Offline" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }),
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        if (req.mode === "navigate") {
          const idx = await caches.match("/index.html");
          if (idx) return idx;
        }
        return new Response("Offline", { status: 503 });
      }),
  );
});
