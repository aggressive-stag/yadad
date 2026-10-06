import type {
  BatchOperations,
  BatchResult,
  DataAdapter,
  DataRecord,
  DocumentError,
  FieldValue,
  Page,
  Query,
  RecordValues,
  SortSpec,
} from "@yadad/core";
import { jsonPointer, RecordConflictError, RecordNotFoundError, RecordValidationError } from "@yadad/core";
import { evaluateCondition } from "./condition.js";

/**
 * Options for the in-process adapters. `fields` maps an entity id to the list of
 * field ids it may hold; when present, a write that names an unknown field id
 * is a validation error. Omit it (or leave an entity out) to accept any field id.
 */
export interface AdapterOptions {
  readonly fields?: Record<string, readonly string[]>;
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

  return {
    async find(entity, query) {
      return runQuery([...table(entity).values()], query);
    },
    async findOne(entity, id) {
      return table(entity).get(id) ?? null;
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
      return record;
    },
    async update(entity, id, patch, meta) {
      const existing = table(entity).get(id);
      if (!existing) throw new RecordNotFoundError(`No "${entity}" record with id "${id}".`);
      const issues = validateFieldIds(options?.fields, entity, patch, ["values"]);
      if (issues.length > 0) throw new RecordValidationError("Some values were rejected.", issues);
      if (meta.baseVersion !== undefined && existing.version !== meta.baseVersion) {
        throw new RecordConflictError(`The "${entity}" record was changed since you loaded it.`, existing);
      }
      const record: DataRecord = {
        ...existing,
        entityRevision: meta.entityRevision,
        version: newVersion(),
        values: { ...existing.values, ...patch },
      };
      table(entity).set(id, record);
      return record;
    },
    async delete(entity, id, meta) {
      const existing = table(entity).get(id);
      if (!existing) throw new RecordNotFoundError(`No "${entity}" record with id "${id}".`);
      if (meta?.baseVersion !== undefined && existing.version !== meta.baseVersion) {
        throw new RecordConflictError(`The "${entity}" record was changed since you loaded it.`, existing);
      }
      table(entity).delete(id);
    },
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
        if (del.baseVersion !== undefined && existing.version !== del.baseVersion) {
          throw new RecordConflictError(`The "${entity}" record was changed since you loaded it.`, existing);
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
        created.push(record);
      }
      return { created, deleted };
    },
  };
}

/** Filter, then sort, then page: the query semantics every in-process adapter shares. */
export function runQuery(records: readonly DataRecord[], query: Query): Page<DataRecord> {
  const { filter } = query;
  const matching = records.filter((r) => !filter || evaluateCondition(filter, r.values));
  const all = sortRecords(matching, query.sort ?? []);
  const items = query.page ? all.slice(query.page.offset, query.page.offset + query.page.limit) : all;
  return { items, total: all.length };
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
