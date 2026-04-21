import { getRating } from "./api/getRating";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 30 * 60 * 1000;
const MAX_CONCURRENT = 3;

const memoryCache = new Map();
const inflight = new Map();
let active = 0;
const queue = [];

function schedule(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    pump();
  });
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const { task, resolve, reject } = queue.shift();
    active++;
    task()
      .then(resolve, reject)
      .finally(() => {
        active--;
        pump();
      });
  }
}

async function getRatingCached(payload) {
  const query = (payload?.query || "").toLowerCase().trim();
  const year = payload?.year || "";
  const typeId = payload?.typeId || "";
  const color = payload?.color || "";
  if (!query) return null;
  const key = `${query}|${year}|${typeId}|${color}`;

  const hit = memoryCache.get(key);
  if (hit) {
    const ttl = hit.value ? CACHE_TTL_MS : NEGATIVE_TTL_MS;
    if (Date.now() - hit.ts < ttl) return hit.value;
  }

  if (inflight.has(key)) return inflight.get(key);

  const stored = await chrome.storage.local.get(key);
  if (stored[key]) {
    const ttl = stored[key].value ? CACHE_TTL_MS : NEGATIVE_TTL_MS;
    if (Date.now() - stored[key].ts < ttl) {
      memoryCache.set(key, stored[key]);
      return stored[key].value;
    }
  }

  const promise = schedule(() => getRating({ query, year, typeId, color }))
    .then((value) => {
      const entry = { value, ts: Date.now() };
      memoryCache.set(key, entry);
      chrome.storage.local.set({ [key]: entry }).catch(() => {});
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

// Clear the persistent cache on install / reload / update so a code change
// (e.g. new scoring logic) isn't masked by stale results from the previous
// version. Fires once when the extension is reloaded from chrome://extensions.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.clear().catch(() => {});
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.type !== "getRating") return false;

  getRatingCached(request.payload || { query: request.query })
    .then((response) => sendResponse([response, null]))
    .catch((error) => sendResponse([null, error?.message || String(error)]));

  return true;
});
