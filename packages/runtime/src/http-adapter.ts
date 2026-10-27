import type { BatchOperations, BatchResult, DataAdapter, DataRecord, DocumentError, Page, PageNotice, Query } from "@yadad/core";
import {
  ForbiddenError,
  RecordConflictError,
  RecordNotFoundError,
  RecordValidationError,
  UnauthorizedError,
} from "@yadad/core";
import { assertQueryHasNoViewer, validCan } from "./adapter-guards.js";
import { resolveRelativeDates } from "./condition.js";

/** A same-origin fetch's credentials mode, mirroring the browser's RequestCredentials. */
export type FetchCredentials = "omit" | "same-origin" | "include";

/**
 * A structural stand-in for `fetch`, so a test can serve the protocol without a
 * DOM. The environment's global `fetch` satisfies this type as-is.
 */
export type FetchLike = (
  input: string,
  init?: {
    readonly method?: string;
    readonly body?: string;
    readonly headers?: Record<string, string>;
    readonly credentials?: FetchCredentials;
  },
) => Promise<{ readonly status: number; readonly json: () => Promise<unknown> }>;

/** Options for {@link createHttpAdapter}. The base URL is host configuration only. */
export interface HttpAdapterOptions {
  /** The protocol base, e.g. "/api/records". A trailing slash is ignored. */
  readonly baseUrl: string;
  /** The fetch to call; defaults to the environment's global fetch. */
  readonly fetch?: FetchLike;
  /** Same-origin by default, so session cookies work without CORS. */
  readonly credentials?: FetchCredentials;
  /** Extra request headers, merged over the JSON defaults. */
  readonly headers?: Record<string, string>;
  /**
   * Called whenever a response has status 401 (not signed in or session
   * expired), e.g. to send the viewer to a sign-in page. The call still
   * rejects with an `UnauthorizedError` as usual; an exception thrown by this
   * hook is ignored.
   */
  readonly onUnauthorized?: () => void;
}

/** One item of the protocol's error body. */
interface ErrorItem {
  readonly path: string;
  readonly code: string;
  readonly message: string;
  readonly hint: string;
}

/** The protocol's non-2xx body: `{ errors: [...] }`, with `"current"` added on 409. */
interface ErrorBody {
  readonly errors?: readonly ErrorItem[];
  readonly current?: DataRecord | null;
}

/**
 * A DataAdapter that speaks the HTTP records protocol (docs/records-protocol.md)
 * to a same-origin backend. Reads build query strings; writes send JSON and are
 * never retried. Every non-2xx status maps to a typed error.
 */
// The runtime compiles without the DOM or node typings; every JS host has a console.
declare const console: { warn(...args: unknown[]): void };

const isPageNotice = (value: unknown): value is PageNotice => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).length === 2 && (v.tone === "info" || v.tone === "warning") && typeof v.text === "string" && v.text.length > 0
  );
};

export function createHttpAdapter(options: HttpAdapterOptions): DataAdapter {
  const base = options.baseUrl.replace(/\/+$/, "");
  const credentials = options.credentials ?? "same-origin";
  // Prefer an injected fetch (tests); otherwise the environment's global fetch.
  const fetchFn: FetchLike = options.fetch ?? (globalThis as unknown as { fetch: FetchLike }).fetch;

  const requestHeaders = (hasBody: boolean): Record<string, string> => ({
    Accept: "application/json",
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
    ...options.headers,
  });

  async function send(method: string, url: string, body?: string): Promise<{ status: number; body: unknown }> {
    const res = await fetchFn(url, {
      method,
      credentials,
      headers: requestHeaders(body !== undefined),
      ...(body !== undefined ? { body } : {}),
    });
    if (res.status === 401) {
      try {
        options.onUnauthorized?.();
      } catch {
        // A failing hook must not hide the UnauthorizedError the caller gets.
      }
    }
    if (res.status === 204) return { status: res.status, body: undefined };
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    return { status: res.status, body: json };
  }

  function throwForStatus(status: number, body: unknown): never {
    const rawErrors: readonly ErrorItem[] | undefined = isObject(body) ? (body as ErrorBody).errors : undefined;
    const errors: readonly ErrorItem[] = Array.isArray(rawErrors) ? rawErrors : [];
    const message = errors[0]?.message ?? `The request failed with status ${status}.`;
    switch (status) {
      case 400:
        throw new RecordValidationError(
          "The server rejected the request.",
          errors.map((e) => ({ path: e.path, code: e.code as DocumentError["code"], message: e.message, hint: e.hint })),
        );
      case 401:
        throw new UnauthorizedError(message);
      case 403:
        throw new ForbiddenError(message);
      case 404:
        throw new RecordNotFoundError(message);
      case 409: {
        const current = isObject(body) ? (body as ErrorBody).current : undefined;
        throw new RecordConflictError(message, isObject(current) ? readRecord(current as unknown as DataRecord) : null);
      }
      default:
        throw new Error(`The server responded with status ${status}.`);
    }
  }

  const post = async <T>(url: string, payload: unknown): Promise<T> => {
    const { status, body } = await send("POST", url, JSON.stringify(payload));
    if (status < 200 || status >= 300) throwForStatus(status, body);
    return body as T;
  };
  const sendPatch = async <T>(url: string, payload: unknown): Promise<T> => {
    const { status, body } = await send("PATCH", url, JSON.stringify(payload));
    if (status < 200 || status >= 300) throwForStatus(status, body);
    return body as T;
  };
  const del = async (url: string): Promise<void> => {
    const { status, body } = await send("DELETE", url);
    if (status < 200 || status >= 300) throwForStatus(status, body);
  };

  return {
    async find(entity, query) {
      assertQueryHasNoViewer(query);
      const { status, body } = await send("GET", `${base}/${entity}${queryString(query)}`);
      // An unknown entity is a 404; the in-process adapters surface it as an empty page.
      if (status === 404) return { items: [], total: 0 };
      if (status < 200 || status >= 300) throwForStatus(status, body);
      const page = body as Page<DataRecord>;
      if (!Array.isArray(page?.items)) return page;
      const { notice, ...rest } = page;
      const valid = isPageNotice(notice);
      if (notice !== undefined && !valid) console.warn("yadad: dropped a malformed notice from a list response");
      return { ...rest, items: page.items.map(readRecord), ...(valid ? { notice } : {}) };
    },
    async findOne(entity, id) {
      const { status, body } = await send("GET", `${base}/${entity}/${encodeURIComponent(id)}`);
      // A missing record (or another user's record) is a 404, read as "not found".
      if (status === 404) return null;
      if (status < 200 || status >= 300) throwForStatus(status, body);
      return readRecord(body as DataRecord);
    },
    async create(entity, values, meta) {
      return readRecord(await post<DataRecord>(`${base}/${entity}`, { values, entityRevision: meta.entityRevision }));
    },
    async update(entity, id, patch, meta) {
      return readRecord(
        await sendPatch<DataRecord>(`${base}/${entity}/${encodeURIComponent(id)}`, {
          values: patch,
          entityRevision: meta.entityRevision,
          baseVersion: meta.baseVersion,
        }),
      );
    },
    async delete(entity, id, meta) {
      const url = `${base}/${entity}/${encodeURIComponent(id)}${meta?.baseVersion !== undefined ? `?baseVersion=${encodeURIComponent(meta.baseVersion)}` : ""}`;
      await del(url);
    },
    async batch(entity, ops: BatchOperations, meta): Promise<BatchResult> {
      const payload: Record<string, unknown> = { entityRevision: meta.entityRevision };
      if (ops.create && ops.create.length > 0) payload.create = ops.create.map((values) => ({ values }));
      if (ops.delete && ops.delete.length > 0) payload.delete = ops.delete;
      const result = await post<BatchResult>(`${base}/${entity}/_batch`, payload);
      return Array.isArray(result?.created) ? { ...result, created: result.created.map(readRecord) } : result;
    },
    // The HTTP adapter speaks the protocol, so act is always available: an
    // unknown entity, record or action is the server's 404, not a missing
    // host handler (that case is the in-process adapters).
    async act(entity, id, action, request): Promise<DataRecord | null> {
      const { status, body } = await send(
        "POST",
        `${base}/${entity}/${encodeURIComponent(id)}/actions/${encodeURIComponent(action)}`,
        JSON.stringify({ input: request.input ?? {}, entityRevision: request.meta.entityRevision, baseVersion: request.meta.baseVersion }),
      );
      if (status === 204) return null; // the action removed the record
      if (status < 200 || status >= 300) throwForStatus(status, body);
      return readRecord(body as DataRecord);
    },
  };
}

/** A record from the server with its `can` checked: a valid one is kept as is, a malformed one is dropped. */
function readRecord(record: DataRecord): DataRecord {
  if (!isObject(record) || !("can" in record)) return record;
  const { can, ...rest } = record;
  const valid = validCan(can);
  return valid === undefined ? rest : { ...rest, can: valid };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Encodes a Query as the protocol's filter/sort/offset/limit query string. */
function queryString(query: Query): string {
  const parts: string[] = [];
  // The protocol only carries fixed values; callers resolve relative dates first, this keeps a stray one off the wire.
  if (query.filter !== undefined) parts.push(`filter=${encodeURIComponent(JSON.stringify(resolveRelativeDates(query.filter)))}`);
  if (query.sort !== undefined) parts.push(`sort=${encodeURIComponent(JSON.stringify(query.sort))}`);
  if (query.page !== undefined) {
    parts.push("cursor" in query.page ? `cursor=${encodeURIComponent(query.page.cursor)}` : `offset=${encodeURIComponent(String(query.page.offset))}`);
    parts.push(`limit=${encodeURIComponent(String(query.page.limit))}`);
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}
