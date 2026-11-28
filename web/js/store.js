import { api } from "./api.js";

const DB_NAME = "rosie.cache";
const STORE_NAME = "resources";
const STALE_MS = 60_000;

const mem = new Map();
const dirty = new Set();
const inflight = new Map();
let onBackgroundUpdate = () => {};
let dbPromise = null;

export function setStoreUpdateHook(fn) {
  onBackgroundUpdate = fn;
}

function openDB() {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function idbGet(key) {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbSet(key, val) {
  const db = await openDB();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(val, key);
  } catch {
    /* ignore quota/storage errors */
  }
}

async function idbClear() {
  const db = await openDB();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
  } catch {
    /* ignore */
  }
}

function fetchFresh(key, path) {
  if (inflight.has(key)) return inflight.get(key);
  const p = api(path)
    .then((data) => {
      const raw = JSON.stringify(data);
      const prev = mem.get(key);
      mem.set(key, { data, raw, at: Date.now() });
      dirty.delete(key);
      idbSet(key, { data, raw });
      return { data, changed: !prev || prev.raw !== raw };
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

function revalidateInBackground(key, path) {
  if (inflight.has(key)) return;
  fetchFresh(key, path)
    .then(({ changed }) => {
      if (changed) onBackgroundUpdate();
    })
    .catch(() => {
      /* offline or auth lost; keep cached copy */
    });
}

/**
 * Stale-while-revalidate read cache (in-memory + IndexedDB).
 * Dirty keys (invalidated by local writes or SSE) fetch fresh first.
 */
export async function cached(key, path) {
  const entry = mem.get(key);
  if (entry && !dirty.has(key)) {
    if (Date.now() - entry.at > STALE_MS) revalidateInBackground(key, path);
    return entry.data;
  }

  if (!dirty.has(key) && !entry) {
    const stored = await idbGet(key);
    if (stored && stored.data !== undefined && !dirty.has(key)) {
      mem.set(key, { data: stored.data, raw: stored.raw || JSON.stringify(stored.data), at: 0 });
      revalidateInBackground(key, path);
      return stored.data;
    }
  }

  try {
    const { data } = await fetchFresh(key, path);
    return data;
  } catch (err) {
    // If offline during a revalidation of previously cached data, fall back to stale copy on reads.
    if (entry && !dirty.has(key)) return entry.data;
    throw err;
  }
}

function markPrefixDirty(prefix) {
  for (const key of mem.keys()) {
    if (key === prefix || key.startsWith(prefix + ":")) dirty.add(key);
  }
  dirty.add(prefix);
}

export function invalidateAll() {
  for (const key of mem.keys()) dirty.add(key);
}

export function invalidateForPath(path) {
  const p = String(path || "").replace(/^\/api/, "");
  if (!p) {
    invalidateAll();
    return;
  }
  if (p.startsWith("/pantry")) markPrefixDirty("pantry");
  else if (p.startsWith("/meals")) markPrefixDirty("meals");
  else if (p.startsWith("/recipes")) {
    markPrefixDirty("recipes");
    markPrefixDirty("meals");
  } else if (p.startsWith("/chores")) {
    markPrefixDirty("chores");
    markPrefixDirty("expenses");
  } else if (p.startsWith("/expenses")) {
    markPrefixDirty("expenses");
    markPrefixDirty("pantry");
  } else if (p.startsWith("/budgets")) markPrefixDirty("budgets");
  else if (p.startsWith("/settings")) markPrefixDirty("settings");
  else if (p.startsWith("/groceries")) {
    markPrefixDirty("groceries");
    // "Put in pantry" moves items into the pantry.
    if (p.startsWith("/groceries/to-pantry")) markPrefixDirty("pantry");
  }
  else invalidateAll();
}

export function clearCache() {
  mem.clear();
  dirty.clear();
  inflight.clear();
  idbClear();
  if (typeof caches !== "undefined") caches.delete("rosie-api-v1").catch(() => {});
}
