const SHELL_CACHE = "lark-shell-v1";
const OFFLINE_CACHE = "lark-offline-v1";
const CACHE_NAMES = [SHELL_CACHE, OFFLINE_CACHE];
const SHELL_ASSETS = [
  "/",
  "/site.webmanifest",
  "/logo.png",
  "/favicon.ico",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    precacheShell()
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => !CACHE_NAMES.includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  const port = event.ports && event.ports[0];
  if (!port) return;
  const message = event.data || {};
  handleMessage(message.type, message.payload)
    .then((data) => port.postMessage({ ok: true, ...data }))
    .catch((error) => port.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.headers.has("range") && isOfflineAudioURL(url)) {
    event.respondWith(rangeFromOfflineCache(request));
    return;
  }
  if (isOfflineAudioURL(url)) {
    event.respondWith(cacheFirst(request, OFFLINE_CACHE));
    return;
  }
  if (isCoverURL(url)) {
    event.respondWith(cacheFirst(request, OFFLINE_CACHE));
    return;
  }
  if (request.mode === "navigate" || request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(networkFirstShell(request));
    return;
  }
  if (url.pathname.startsWith("/assets/") || SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  }
});

function isOfflineAudioURL(url) {
  return /^\/api\/offline\/songs\/\d+\/audio$/.test(url.pathname);
}

function isCoverURL(url) {
  return /^\/api\/songs\/\d+\/cover$/.test(url.pathname) || /^\/api\/albums\/\d+\/cover$/.test(url.pathname) || /^\/api\/artists\/\d+\/cover$/.test(url.pathname);
}

async function handleMessage(type, payload) {
  if (type === "CACHE_URLS") {
    const urls = Array.isArray(payload?.urls) ? payload.urls.filter(Boolean) : [];
    const failOnError = payload?.failOnError !== false;
    return cacheURLs(urls, failOnError);
  }
  if (type === "GET_OFFLINE_USAGE") {
    return offlineUsage();
  }
  if (type === "CLEAR_OFFLINE_CACHE") {
    await caches.delete(OFFLINE_CACHE);
    await caches.open(OFFLINE_CACHE);
    return { bytes: 0, entries: 0, audio_entries: 0 };
  }
  throw new Error("unknown service worker message");
}

async function cacheURLs(urls, failOnError = true) {
  const cache = await caches.open(OFFLINE_CACHE);
  const failures = [];
  let cached = 0;
  await Promise.all(urls.map(async (url) => {
    const request = new Request(url, { credentials: "include", cache: "reload" });
    try {
      const response = await fetch(request);
      if (!response.ok) {
        failures.push(`${url} ${response.status}`);
        return;
      }
      await cache.put(request, response);
      cached += 1;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }));
  if (failOnError && failures.length) throw new Error(failures[0]);
  return { cached, failed: failures.length };
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(new Request(url, { cache: "reload" }))));
  await refreshShellDocument(cache);
}

async function refreshShellDocument(cache) {
  const response = await fetch(new Request("/", { cache: "reload" }));
  if (!response.ok) return;
  const htmlCopy = response.clone();
  await cache.put("/", response.clone());
  await cache.put("/index.html", response.clone());
  await cacheShellAssetsFromHTML(cache, await htmlCopy.text());
}

async function cacheShellAssetsFromHTML(cache, html) {
  const urls = shellAssetURLs(html);
  await Promise.allSettled(urls.map((url) => cache.add(new Request(url, { cache: "reload" }))));
}

function shellAssetURLs(html) {
  const urls = new Set();
  const pattern = /\b(?:src|href)=["']([^"']+)["']/g;
  let match;
  while ((match = pattern.exec(html))) {
    try {
      const url = new URL(match[1], self.location.origin);
      if (url.origin === self.location.origin && url.pathname.startsWith("/assets/")) {
        urls.add(url.pathname + url.search);
      }
    } catch {
      // Ignore malformed asset references in the generated shell.
    }
  }
  return Array.from(urls);
}

async function responseByteSize(response) {
  const headerSize = Number(response.headers.get("content-length") || "");
  if (Number.isFinite(headerSize) && headerSize > 0) return headerSize;
  return response.clone().arrayBuffer().then((buffer) => buffer.byteLength).catch(() => 0);
}

async function offlineUsage() {
  const cache = await caches.open(OFFLINE_CACHE);
  const requests = await cache.keys();
  const items = await Promise.all(requests.map(async (request) => {
    const response = await cache.match(request);
    if (!response) return { bytes: 0, audio: false };
    return {
      bytes: await responseByteSize(response),
      audio: isOfflineAudioURL(new URL(request.url)),
    };
  }));
  const bytes = items.reduce((total, item) => total + item.bytes, 0);
  const audioEntries = items.filter((item) => item.audio).length;
  return { bytes, entries: requests.length, audio_entries: audioEntries };
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.status === 200) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      if (response.headers.get("content-type")?.includes("text/html")) {
        await cacheShellAssetsFromHTML(cache, await response.clone().text());
      }
    }
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match("/index.html")) || Response.error();
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreVary: true });
  const update = fetch(request).then((response) => {
    if (response.ok) void cache.put(request, response.clone());
    return response;
  }).catch(() => undefined);
  return cached || update || fetch(request);
}

async function rangeFromOfflineCache(request) {
  const cache = await caches.open(OFFLINE_CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  if (!cached) return fetch(request);
  const range = request.headers.get("range") || "";
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
  if (!match) return cached;

  const buffer = await cached.arrayBuffer();
  const size = buffer.byteLength;
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${size}`,
        "Accept-Ranges": "bytes",
      },
    });
  }
  end = Math.min(end, size - 1);
  const chunk = buffer.slice(start, end + 1);
  const headers = new Headers(cached.headers);
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", String(chunk.byteLength));
  headers.set("Content-Type", cached.headers.get("Content-Type") || "audio/mpeg");
  return new Response(chunk, { status: 206, statusText: "Partial Content", headers });
}
