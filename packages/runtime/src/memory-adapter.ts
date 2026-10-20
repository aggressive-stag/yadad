import type {
  BatchOperations,
  BatchResult,
  DataAdapter,
  DataRecord,
  DocumentError,
  FieldValue,
  Page,
  Query,
  RecordPermissions,
  RecordValues,
  SortSpec,
} from "@yadad/core";
import { jsonPointer, RecordConflictError, RecordNotFoundError, RecordValidationError } from "@yadad/core";
import { assertQueryHasNoViewer, withPermissions, assertPermitted, assertActionRunnable, actEffect } from "./adapter-guards.js";
import { evaluateCondition } from "./condition.js";
import type { ActionHandler } from "./actions.js";

/**
 * Options for the in-process adapters. `fields` maps an entity id to the list of
 * field ids it may hold; when present, a write that names an unknown field id
 * is a validation error. Omit it (or leave an entity out) to accept any field id.
 */
export interface AdapterOptions {
  readonly fields?: Record<string, readonly string[]>;
  /**
   * States what the current viewer may do with a record (RFC 0006). It is
   * applied at read time to every record the adapter returns, as `can`, and
   * enforced: an update or delete of a record whose permissions say `false`
   * throws a ForbiddenError, as a server's 403 would. Host code, not a document.
   */
  readonly recordPermissions?: (record: DataRecord) => RecordPermissions | undefined;
  /**
   * Host- or test-supplied action handlers (RFC 0007), keyed `<entity>.<action>`
   * (id patterns contain no dot, so the key is unambiguous). `act` runs the
   * handler after the 404/409/403 checks; like `recordPermissions` it is host
   * code, not part of any document.
   */
  readonly actions?: Readonly<Record<string, ActionHandler>>;
  /**
   * `"cursor"`: page like a server that never counts (RFC 0007) — `find`
   * returns no `total` and an opaque `next` (null on the last page), and
   * `{ cursor, limit }` pages are accepted. Host code, like `recordPermissions`;
   * the default keeps today's offset paging with a `total`.
   */
  readonly paging?: "cursor";
}

/** In-memory DataAdapter for tests, the showcase and local dev. Nothing persists. */
export function createMemoryAdapter(options?: AdapterOptions): DataAdapter {
  const tables = new Map<string, Map<string, DataRecord>>();
  let nextId = 1;
  let nextVersion = 1;

  const table = (entity: string): Map<string, DataRecord> => {
    let t = tables.get(entity);
    if (!t) {
      t = new Map();
      tables.set(entity, t);
    }
    return t;
  };
  const newVersion = (): string => String(nextVersion++);

  // Present only when the host supplied handlers: an adapter that cannot run
  // any action must not advertise act (RFC 0007 renders that case as an
  // ErrorSummary, not as buttons whose every press 404s).
  const act: DataAdapter["act"] =
    options?.actions === undefined
      ? undefined
      : async (entity, id, action, request) => {
          const t = table(entity);
          const { handler, record: existing } = assertActionRunnable(options, entity, id, action, t.get(id), request);
          const effect = actEffect(handler(withPermissions(options, existing), request.input ?? {}));
          if (effect.kind === "remove") {
            t.delete(id);
            return null;
          }
          const record: DataRecord = {
            ...existing,
            entityRevision: request.meta.entityRevision,
            version: newVersion(),
            values: { ...existing.values, ...effect.values },
          };
          t.set(id, record);
          return withPermissions(options, record);
        };

  return {
    async find(entity, query) {
      const page = runQuery([...table(entity).values()], query, options?.paging);
      return { ...page, items: page.items.map((r) => withPermissions(options, r)) };
    },
    async findOne(entity, id) {
      const record = table(entity).get(id);
      return record ? withPermissions(options, record) : null;
    },
    async create(entity, values, meta) {
      const issues = validateFieldIds(options?.fields, entity, values, ["values"]);
      if (issues.length > 0) throw new RecordValidationError("Some values were rejected.", issues);
      const record: DataRecord = {
        id: String(nextId++),
        entityId: entity,
        entityRevision: meta.entityRevision,
        version: newVersion(),
        values: { ...values },
      };
      table(entity).set(record.id, record);
      return withPermissions(options, record);
    },
    async update(entity, id, patch, meta) {
      const existing = table(entity).get(id);
      if (!existing) throw new RecordNotFoundError(`No "${entity}" record with id "${id}".`);
      assertPermitted(options, existing, "update");
      const issues = validateFieldIds(options?.fields, entity, patch, ["values"]);
      if (issues.length > 0) throw new RecordValidationError("Some values were rejected.", issues);
      if (meta.baseVersion !== undefined && existing.version !== meta.baseVersion) {
        throw new RecordConflictError(`The "${entity}" record was changed since you loaded it.`, withPermissions(options, existing));
      }
      if (Object.keys(patch).length === 0) return withPermissions(options, existing);
      const record: DataRecord = {
        ...existing,
        entityRevision: meta.entityRevision,
        version: newVersion(),
        values: { ...existing.values, ...patch },
      };
      table(entity).set(id, record);
      return withPermissions(options, record);
    },
    async delete(entity, id, meta) {
      const existing = table(entity).get(id);
      if (!existing) throw new RecordNotFoundError(`No "${entity}" record with id "${id}".`);
      assertPermitted(options, existing, "delete");
      if (meta?.baseVersion !== undefined && existing.version !== meta.baseVersion) {
        throw new RecordConflictError(`The "${entity}" record was changed since you loaded it.`, withPermissions(options, existing));
      }
      table(entity).delete(id);
    },
    ...(act === undefined ? {} : { act }),
    async batch(entity, ops: BatchOperations, meta): Promise<BatchResult> {
      const t = table(entity);
      const creates = ops.create ?? [];
      const deletes = ops.delete ?? [];
      // Validate everything before writing anything: atomic all-or-nothing.
      const issues: DocumentError[] = [];
      creates.forEach((values, i) => {
        issues.push(...validateFieldIds(options?.fields, entity, values, ["create", i, "values"]));
      });
      if (issues.length > 0) throw new RecordValidationError("Some values were rejected.", issues);
      for (const del of deletes) {
        const existing = t.get(del.id);
        if (!existing) throw new RecordNotFoundError(`No "${entity}" record with id "${del.id}".`);
        assertPermitted(options, existing, "delete");
        if (del.baseVersion !== undefined && existing.version !== del.baseVersion) {
          throw new RecordConflictError(`The "${entity}" record was changed since you loaded it.`, withPermissions(options, existing));
        }
      }
      const deleted: string[] = [];
      for (const del of deletes) {
        t.delete(del.id);
        deleted.push(del.id);
      }
      const created: DataRecord[] = [];
      for (const values of creates) {
        const record: DataRecord = {
          id: String(nextId++),
          entityId: entity,
          entityRevision: meta.entityRevision,
          version: newVersion(),
          values: { ...values },
        };
        t.set(record.id, record);
        created.push(withPermissions(options, record));
      }
      return { created, deleted };
    },
  };
}

/** Filter, then sort, then page: the query semantics every in-process adapter shares. A `viewerIn` leaf in the filter is rejected. With `paging: "cursor"` the page carries no `total` and an opaque `next` (RFC 0007). */
export function runQuery(records: readonly DataRecord[], query: Query, paging?: "cursor"): Page<DataRecord> {
  assertQueryHasNoViewer(query);
  const { filter } = query;
  const matching = records.filter((r) => !filter || evaluateCondition(filter, r.values));
  const all = sortRecords(matching, query.sort ?? []);
  if (paging === "cursor") {
    const limit = query.page?.limit ?? all.length;
    const offset = query.page === undefined || !("cursor" in query.page) ? 0 : decodeCursor(query.page.cursor);
    const items = all.slice(offset, offset + limit);
    return { items, next: offset + items.length < all.length ? encodeCursor(offset + items.length) : null };
  }
  // Without the cursor option a cursor query is read as an offset: a host that
  // mixes both styles still gets a stable answer from this in-process store.
  const offset = query.page === undefined ? 0 : "cursor" in query.page ? Number.parseInt(query.page.cursor, 10) || 0 : query.page.offset;
  const items = query.page ? all.slice(offset, offset + query.page.limit) : all;
  return { items, total: all.length };
}

const CURSOR_PREFIX = "c0:"; // an encoded offset: reversed base36, so it never looks like a plain number

/** Opaque continuation token (RFC 0007): only the memory adapters' runQuery produces and reads it. */
export function encodeCursor(offset: number): string {
  return `${CURSOR_PREFIX}${offset.toString(36).split("").reverse().join("")}`;
}

function decodeCursor(token: string): number {
  if (!token.startsWith(CURSOR_PREFIX)) return 0;
  const chars = token
    .slice(CURSOR_PREFIX.length)
    .split("")
    .reverse()
    .join("");
  const n = Number.parseInt(chars, 36);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Walk a server that does not count (no `total`, `next` instead) page by page
 * up to the cap (RFC 0007). Pass the page the caller already fetched as
 * `first` to continue from it; otherwise the walk starts at offset 0. The walk
 * stops at an empty page or a page with no `next`; `hasMore` says the cap was
 * reached while a `next` was still pending.
 */
export async function walkWithNext(
  adapter: DataAdapter,
  entityId: string,
  base: Omit<Query, "page">,
  options: { readonly first?: Page<DataRecord>; readonly maxRecords: number; readonly pageSize: number },
): Promise<{ readonly items: DataRecord[]; readonly hasMore: boolean }> {
  const items: DataRecord[] = [];
  let cursor: string | null | undefined = options.first === undefined ? undefined : (options.first.next ?? null);
  if (options.first !== undefined) items.push(...options.first.items);
  while (items.length < options.maxRecords && cursor !== null) {
    const limit = Math.min(options.pageSize, options.maxRecords - items.length);
    const page = await adapter.find(entityId, { ...base, page: cursor === undefined ? { offset: items.length, limit } : { cursor, limit } });
    items.push(...page.items);
    cursor = page.next ?? null;
    if (page.items.length === 0) return { items, hasMore: false };
  }
  return { items, hasMore: cursor !== null };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Orders two field values; null and missing values come last whatever the direction. */
export function compareFieldValues(a: FieldValue | undefined, b: FieldValue | undefined, dir: "asc" | "desc"): number {
  const emptyA = a === null || a === undefined || a === "";
  const emptyB = b === null || b === undefined || b === "";
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  const order =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : typeof a === "boolean" && typeof b === "boolean"
        ? Number(a) - Number(b)
        : collator.compare(String(a), String(b));
  return dir === "asc" ? order : -order;
}

/** Stable multi-key sort; ties keep creation order. */
export function sortRecords(records: readonly DataRecord[], sort: readonly SortSpec[]): DataRecord[] {
  return [...records].sort((a, b) => {
    for (const { field, dir } of sort) {
      const order = compareFieldValues(a.values[field], b.values[field], dir);
      if (order !== 0) return order;
    }
    return 0;
  });
}

/**
 * Validation errors for field ids that are not in the entity's known set.
 * `fields` maps entity id → allowed field ids; an absent entry (or absent map)
 * means the entity is open and any field id is accepted. `valuesPath` points at
 * the `values` object inside the request body (e.g. `["values"]`, or
 * `["create", i, "values"]` for a batch item), so the resulting JSON Pointers
 * name the offending field within the body.
 */
export function validateFieldIds(
  fields: Record<string, readonly string[]> | undefined,
  entity: string,
  values: RecordValues,
  valuesPath: readonly (string | number)[],
): readonly DocumentError[] {
  const allowed = fields?.[entity];
  if (!allowed) return [];
  return Object.keys(values)
    .filter((fieldId) => !allowed.includes(fieldId))
    .map((fieldId) => ({
      path: jsonPointer([...valuesPath, fieldId]),
      code: "unknown-property" as const,
      message: `Unknown field "${fieldId}" on entity "${entity}".`,
      hint: "Field ids are defined by the entity, not by the record.",
    }));
}
