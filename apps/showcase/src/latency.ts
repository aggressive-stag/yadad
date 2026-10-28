import type { DataAdapter } from "@yadad/core";

/**
 * The delay (milliseconds) a host with a real network would add to every read and write, read from the
 * page's `?latency=` parameter; 0 (no delay) when absent. With a delay a reload shows its loading state,
 * so a view rebuilds its records the way it does against a server. Checking focus behavior needs that.
 */
export function pageLatency(search: string = typeof window === "undefined" ? "" : window.location.search): number {
  const raw = Number(new URLSearchParams(search).get("latency"));
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 5000) : 0;
}

/** The adapter with `ms` added before each call settles; the same adapter when `ms` is 0. */
export function withLatency(adapter: DataAdapter, ms: number = pageLatency()): DataAdapter {
  if (ms <= 0) return adapter;
  const wait = <T,>(run: () => Promise<T>): Promise<T> => new Promise((resolve) => setTimeout(resolve, ms)).then(run);
  return {
    ...adapter,
    find: (entity, query) => wait(() => adapter.find(entity, query)),
    findOne: (entity, id) => wait(() => adapter.findOne(entity, id)),
    update: (entity, id, patch, meta) => wait(() => adapter.update(entity, id, patch, meta)),
    ...(adapter.act === undefined ? {} : { act: (entity, id, action, request) => wait(() => adapter.act!(entity, id, action, request)) }),
  };
}
