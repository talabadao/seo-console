// Per-job counters, carried through async calls without threading arguments into every provider helper. A
// provider request made inside runWithJobContext is attributed to that job (requests, retries); outside a job
// (e.g. an interactive call that hasn't moved to the cache yet) only the process totals are updated.

import { AsyncLocalStorage } from "node:async_hooks";

export interface JobCounters {
  providerRequests: number;
  retries: number;
}

const storage = new AsyncLocalStorage<JobCounters>();

/** Process-wide totals, for tests and the capacity harness (not persisted). */
export const processTotals = { providerRequests: 0, retries: 0, byProvider: {} as Record<string, number> };

export function runWithJobContext<T>(counters: JobCounters, fn: () => Promise<T>): Promise<T> {
  return storage.run(counters, fn);
}

export function noteProviderRequest(provider: string): void {
  processTotals.providerRequests++;
  processTotals.byProvider[provider] = (processTotals.byProvider[provider] ?? 0) + 1;
  const c = storage.getStore();
  if (c) c.providerRequests++;
}

export function noteRetry(): void {
  processTotals.retries++;
  const c = storage.getStore();
  if (c) c.retries++;
}

export function resetProcessTotals(): void {
  processTotals.providerRequests = 0;
  processTotals.retries = 0;
  processTotals.byProvider = {};
}
