import type { BatchOperations, BatchResult, DataAdapter, DataRecord, DocumentError, Query, RecordValues, WriteMeta } from "@yadad/core";
import { ForbiddenError, jsonPointer, RecordConflictError, RecordNotFoundError, RecordValidationError } from "@yadad/core";
import type { ViewState } from "@yadad/runtime";
import { runQuery } from "@yadad/runtime";

/** What the data source is doing: the values of the `source` axis. */
export type SourceState = "ready" | "loading" | "error" | "refused" | "conflict" | "notice-info" | "notice-warning";

export const SOURCE_STATES: readonly SourceState[] = ["ready", "loading", "error", "refused", "conflict", "notice-info", "notice-warning"];

export interface StateAdapterOptions {
  /**
   * How the source behaves. Defaults to "ready".
   * - "ready": a working in-memory adapter.
   * - "loading": every read (`find`, `findOne`) never settles.
   * - "error": every read rejects with `new Error(message)`, like a network failure.
   * - "refused": every write is refused: a `RecordValidationError` (400) with one
   *   field error, or a `ForbiddenError` (403) when `status` is 403.
   * - "conflict": every write throws a `RecordConflictError` (409) carrying the stored record.
   * - "notice-info" / "notice-warning" (RFC 0010 item 7): a working source whose list answers carry
   *   `notice: { tone, text }`, the text being `message`.
   * Reads work in "refused" and "conflict"; writes work in "loading" and "error" and in the notice states.
   */
  readonly source?: SourceState;
  /** The readable message of a failure. Each mode has a default. */
  readonly message?: string;
  /** For "refused": 400 (default) or 403. */
  readonly status?: 400 | 403;
  /** For a 400: the field id the error points at. Defaults to "" (the record as a whole). */
  readonly field?: string;
}

/** A DataAdapter whose behavior can be switched while a test runs. */
export interface StateAdapter extends DataAdapter {
  /** The source behavior now in force (with its defaults filled in). */
  readonly options: Required<Pick<StateAdapterOptions, "source" | "message" | "status" | "field">>;
  /** Changes the behavior from now on. Options not given keep their previous value. */
  configure(options: StateAdapterOptions): void;
  /** Every record currently held, in creation order. */
  records(): readonly DataRecord[];
}

const DEFAULT_MESSAGES: Record<SourceState, string> = {
  ready: "",
  loading: "",
  error: "The data source did not answer. Try again in a moment.",
  refused: "The data source refused this change.",
  conflict: "The record was changed since you loaded it.",
  "notice-info": "This answer was served from a cached copy.",
  "notice-warning": "This answer was served without search, so results may be incomplete.",
};

/** The records a state puts in the data source: its own, or those of the views it embeds. */
export function stateRecords(state: ViewState): readonly DataRecord[] {
  const out = new Map<string, DataRecord>();
  const put = (records: readonly DataRecord[]): void => {
    for (const record of records) if (!out.has(`${record.entityId}/${record.id}`)) out.set(`${record.entityId}/${record.id}`, record);
  };
  // Written over the collection widgets' records: the groups axis owns the entity's record values for the state,
  // the way the records axis owns them — so `aggregateSeries`, reading through the adapter, sees exactly `groups` groups.
  const overwrite = (records: readonly DataRecord[]): void => {
    for (const record of records) out.set(`${record.entityId}/${record.id}`, record);
  };
  const visit = (render: ViewState["render"]): void => {
    if (render.kind === "dashboard") {
      for (const widget of render.widgets) visit(widget.state.render);
      // RFC 0001 slice 2 (card 43g): a series widget's groups need their own seeded records.
      for (const series of render.series ?? []) overwrite(series.records);
    } else if (render.kind !== "form") {
      put(render.records);
    }
  };
  visit(state.render);
  return [...out.values()];
}

/**
 * A DataAdapter seeded with a state's records (or an explicit record list) that
 * can be told to behave like a source that is loading, failing, refusing writes
 * or in conflict. Every failure is a core error (`RecordValidationError`,
 * `ForbiddenError`, `RecordConflictError`) or a plain `Error` for a failed
 * read, as the records protocol and the HTTP adapter produce.
 */
export function createStateAdapter(seed: ViewState | readonly DataRecord[], options: StateAdapterOptions = {}): StateAdapter {
  const initial: readonly DataRecord[] = Array.isArray(seed) ? (seed as readonly DataRecord[]) : stateRecords(seed as ViewState);
  const tables = new Map<string, Map<string, DataRecord>>();
  const table = (entity: string): Map<string, DataRecord> => {
    let t = tables.get(entity);
    if (!t) tables.set(entity, (t = new Map()));
    return t;
  };
  for (const record of initial) table(record.entityId).set(record.id, record);
  let nextId = 1;
  let nextVersion = 1 + initial.reduce((max, r) => Math.max(max, Number.parseInt(r.version, 10) || 0), 0);

  let current: StateAdapter["options"] = { source: "ready", message: DEFAULT_MESSAGES.ready, status: 400, field: "" };
  const configure = (next: StateAdapterOptions): void => {
    const source = next.source ?? current.source;
    current = {
      source,
      // A new source resets the message to that source's default unless one is given.
      message: next.message ?? (next.source !== undefined ? DEFAULT_MESSAGES[source] : current.message),
      status: next.status ?? current.status,
      field: next.field ?? current.field,
    };
  };
  configure(options);

  const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);
  const read = async <T,>(run: () => T): Promise<T> => {
    if (current.source === "loading") return never<T>();
    if (current.source === "error") throw new Error(current.message);
    return run();
  };
  const refuse = (entity: string, id?: string): void => {
    if (current.source === "refused") {
      if (current.status === 403) throw new ForbiddenError(current.message);
      const issue: DocumentError = {
        path: current.field === "" ? "" : jsonPointer([current.field]),
        code: "invalid-value",
        message: current.message,
        hint: "Change the value and save again.",
      };
      throw new RecordValidationError(current.message, [issue]);
    }
    if (current.source === "conflict") {
      throw new RecordConflictError(current.message, id === undefined ? null : (table(entity).get(id) ?? null));
    }
  };
  const make = (entity: string, values: RecordValues, meta: WriteMeta): DataRecord => ({
    id: `new-${nextId++}`,
    entityId: entity,
    entityRevision: meta.entityRevision,
    version: String(nextVersion++),
    values: { ...values },
  });

  return {
    get options() {
      return current;
    },
    configure,
    records: () => [...tables.values()].flatMap((t) => [...t.values()]),
    find: (entity: string, query: Query) =>
      read(() => {
        const page = runQuery([...table(entity).values()], query);
        if (current.source === "notice-info" || current.source === "notice-warning") {
          return { ...page, notice: { tone: current.source === "notice-info" ? ("info" as const) : ("warning" as const), text: current.message } };
        }
        return page;
      }),
    findOne: (entity: string, id: string) => read(() => table(entity).get(id) ?? null),
    async create(entity, values, meta) {
      refuse(entity);
      const record = make(entity, values, meta);
      table(entity).set(record.id, record);
      return record;
    },
    async update(entity, id, patch, meta) {
      refuse(entity, id);
      const existing = table(entity).get(id);
      if (!existing) throw new RecordNotFoundError(`No "${entity}" record with id "${id}".`);
      if (meta.baseVersion !== undefined && existing.version !== meta.baseVersion) {
        throw new RecordConflictError(`The "${entity}" record was changed since you loaded it.`, existing);
      }
      if (Object.keys(patch).length === 0) return existing;
      const record: DataRecord = { ...existing, entityRevision: meta.entityRevision, version: String(nextVersion++), values: { ...existing.values, ...patch } };
      table(entity).set(id, record);
      return record;
    },
    async delete(entity, id, meta) {
      refuse(entity, id);
      const existing = table(entity).get(id);
      if (!existing) throw new RecordNotFoundError(`No "${entity}" record with id "${id}".`);
      if (meta?.baseVersion !== undefined && existing.version !== meta.baseVersion) {
        throw new RecordConflictError(`The "${entity}" record was changed since you loaded it.`, existing);
      }
      table(entity).delete(id);
    },
    async act(entity, id, action, request) {
      // A working source can run actions (RFC 0007): same guard order as the memory adapter —
      // unknown record and stale baseVersion first, then the source's refusal, then a no-op patch.
      const existing = table(entity).get(id);
      if (!existing) throw new RecordNotFoundError(`No "${entity}" record with id "${id}".`);
      if (existing.version !== request.meta.baseVersion) {
        throw new RecordConflictError(`The "${entity}" record was changed since you loaded it.`, existing);
      }
      refuse(entity, id);
      return existing; // a no-op patch: the record comes back unchanged
    },
    async batch(entity, ops: BatchOperations, meta): Promise<BatchResult> {
      refuse(entity, ops.delete?.[0]?.id);
      const t = table(entity);
      for (const del of ops.delete ?? []) {
        const existing = t.get(del.id);
        if (!existing) throw new RecordNotFoundError(`No "${entity}" record with id "${del.id}".`);
        if (del.baseVersion !== undefined && existing.version !== del.baseVersion) {
          throw new RecordConflictError(`The "${entity}" record was changed since you loaded it.`, existing);
        }
      }
      const deleted = (ops.delete ?? []).map((d) => d.id);
      for (const id of deleted) t.delete(id);
      const created = (ops.create ?? []).map((values) => make(entity, values, meta));
      for (const record of created) t.set(record.id, record);
      return { created, deleted };
    },
  };
}
