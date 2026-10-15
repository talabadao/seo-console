// A short-lived, per-server-instance cache for project summaries, so moving
// around the portfolio doesn't re-query every provider. Keys include the user
// id, so one account can never be served another account's summary.

const TTL_MS = 15 * 60_000;
const MAX_ENTRIES = 500;

const store = new Map<string, { at: number; value: unknown }>();

export function cacheGet<T>(key: string, now = Date.now()): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (now - hit.at > TTL_MS) {
    store.delete(key);
    return null;
  }
  return hit.value as T;
}

export function cacheSet(key: string, value: unknown, now = Date.now()): void {
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value!);
  store.set(key, { at: now, value });
}

export function cacheClear(): void {
  store.clear();
}
