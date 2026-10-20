import { describe, expect, test } from "vitest";
import type { BatchOperations, Condition, DataAdapter, DataRecord, Query, RecordValues, RecordPermissions } from "@yadad/core";
import {
  ForbiddenError,
  RecordConflictError,
  RecordNotFoundError,
  RecordValidationError,
  UnauthorizedError,
} from "@yadad/core";
import { createKeyValueAdapter } from "./key-value-adapter.js";
import type { KeyValueStore } from "./key-value-adapter.js";
import { createHttpAdapter } from "./http-adapter.js";
import type { FetchLike } from "./http-adapter.js";
import { createMemoryAdapter } from "./memory-adapter.js";
import type { AdapterOptions } from "./memory-adapter.js";
import { instantRangeBounds } from "./datetime.js";
import type { ActionHandler } from "./actions.js";

const ENTITY = "set";
const FIELDS: AdapterOptions = { fields: { set: ["exercise", "weight", "reps", "due", "when"] } };
const REVISION = 3;

async function expectError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the operation to fail, but it succeeded");
}

function freshStore(): KeyValueStore {
  const data = new Map<string, string>();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

/**
 * A same-origin HTTP server that speaks the records protocol (docs/records-protocol.md)
 * from a memory adapter. It also records every request so the HTTP adapter's encoding
 * can be asserted. No `URL` or DOM is used: paths and queries are parsed with string
 * ops and `decodeURIComponent`, matching the runtime's `lib: ES2023`.
 */
function makeFakeServer(options?: AdapterOptions): { adapter: DataAdapter; requests: FakeRequest[] } {
  const db = createMemoryAdapter(options);
  const requests: FakeRequest[] = [];
  const base = "/api/records";

  const parseUrl = (input: string): { urlPath: string; query: Record<string, string> } => {
    const qIndex = input.indexOf("?");
    const urlPath = qIndex === -1 ? input : input.slice(0, qIndex);
    const query: Record<string, string> = {};
    if (qIndex !== -1) {
      for (const pair of input.slice(qIndex + 1).split("&")) {
        if (pair === "") continue;
        const eq = pair.indexOf("=");
        const key = eq === -1 ? pair : decodeURIComponent(pair.slice(0, eq));
        const value = eq === -1 ? "" : decodeURIComponent(pair.slice(eq + 1));
        query[key] = value;
      }
    }
    return { urlPath, query };
  };

  const toQuery = (query: Record<string, string>): Query => {
    const filter = query["filter"];
    const sort = query["sort"];
    const offset = query["offset"];
    const cursor = query["cursor"];
    const limit = query["limit"];
    return {
      ...(filter !== undefined ? { filter: JSON.parse(filter) } : {}),
      ...(sort !== undefined ? { sort: JSON.parse(sort) } : {}),
      ...(cursor !== undefined && limit !== undefined ? { page: { cursor, limit: Number(limit) } } : {}),
      ...(offset !== undefined && limit !== undefined ? { page: { offset: Number(offset), limit: Number(limit) } } : {}),
    } as Query;
  };

  const json = (status: number, payload: unknown): { status: number; json: () => Promise<unknown> } => ({
    status,
    json: async () => payload,
  });

  const errorBody = (
    errors: readonly { path: string; code: string; message: string; hint: string }[],
    current?: unknown,
  ): Record<string, unknown> => {
    const body: Record<string, unknown> = { errors };
    if (current !== undefined) body.current = current;
    return body;
  };

  const toProtocolResponse = (error: unknown): { status: number; json: () => Promise<unknown> } => {
    if (error instanceof RecordValidationError) {
      return json(
        400,
        errorBody(
          error.issues.map((issue) => ({ path: issue.path, code: issue.code, message: issue.message, hint: issue.hint })),
        ),
      );
    }
    if (error instanceof RecordConflictError) {
      return json(
        409,
        errorBody([{ path: "", code: "conflict", message: error.message, hint: "Reload to see the latest version." }], error.current),
      );
    }
    if (error instanceof RecordNotFoundError) {
      return json(404, errorBody([{ path: "", code: "not-found", message: error.message, hint: "Reload to refresh the list." }]));
    }
    if (error instanceof UnauthorizedError) {
      return json(401, errorBody([{ path: "", code: "unauthorized", message: error.message, hint: "Sign in and try again." }]));
    }
    if (error instanceof ForbiddenError) {
      return json(403, errorBody([{ path: "", code: "forbidden", message: error.message, hint: "You are not allowed to do that." }]));
    }
    return json(
      500,
      errorBody([{ path: "", code: "invalid-value", message: error instanceof Error ? error.message : "Unexpected server error.", hint: "Reload and try again." }]),
    );
  };

  const fetch: FetchLike = async (input, init) => {
    const method = init?.method ?? "GET";
    const { urlPath, query } = parseUrl(input);
    const bodyText = init?.body;
    const body = bodyText !== undefined ? (JSON.parse(bodyText) as Record<string, unknown>) : undefined;
    const path = urlPath.slice(base.length);
    requests.push({ method, url: input, path, query, body, credentials: init?.credentials, headers: init?.headers });

    const segs = path.split("/").filter((segment) => segment !== "");
    const entity = segs[0] ?? "";
    const id: string | undefined = segs[1];

    try {
      if (method === "GET" && id === undefined) {
        return json(200, await db.find(entity, toQuery(query)));
      }
      if (method === "GET" && id !== undefined) {
        const record = await db.findOne(entity, id);
        if (record === null) return json(404, errorBody([{ path: "", code: "not-found", message: `No "${entity}" record with id "${id}".`, hint: "Reload to refresh the list." }]));
        return json(200, record);
      }
      if (method === "POST" && id === undefined) {
        const payload = body as { values: RecordValues; entityRevision: number };
        return json(201, await db.create(entity, payload.values, { entityRevision: payload.entityRevision }));
      }
      if (method === "POST" && id === "_batch") {
        const payload = body as { entityRevision: number; create?: { values: RecordValues }[]; delete?: { id: string; baseVersion?: string }[] };
        const ops: BatchOperations = {
          ...(payload.create !== undefined ? { create: payload.create.map((item) => item.values) } : {}),
          ...(payload.delete !== undefined ? { delete: payload.delete } : {}),
        };
        return json(200, await db.batch(entity, ops, { entityRevision: payload.entityRevision }));
      }
      if (method === "PATCH" && id !== undefined) {
        const payload = body as { values: RecordValues; entityRevision: number; baseVersion?: string };
        const meta = {
          entityRevision: payload.entityRevision,
          ...(payload.baseVersion !== undefined ? { baseVersion: payload.baseVersion } : {}),
        };
        return json(200, await db.update(entity, id, payload.values, meta));
      }
      if (method === "DELETE" && id !== undefined) {
        const baseVersion = query["baseVersion"];
        await db.delete(entity, id, baseVersion !== undefined ? { entityRevision: 0, baseVersion } : undefined);
        return { status: 204, json: async () => undefined };
      }
      return json(404, errorBody([{ path: "", code: "not-found", message: `No "${entity}" resource at this path.`, hint: "Check the path." }]));
    } catch (error) {
      return toProtocolResponse(error);
    }
  };

  return { adapter: createHttpAdapter({ baseUrl: base, fetch }), requests };
}

interface FakeRequest {
  readonly method: string;
  readonly url: string;
  readonly path: string;
  readonly query: Record<string, string>;
  readonly body: Record<string, unknown> | undefined;
  readonly credentials: string | undefined;
  readonly headers: Record<string, string> | undefined;
}

/**
 * The shared DataAdapter contract, run against every adapter. Each test gets a fresh
 * instance so state never leaks between scenarios.
 */
function runConformance(label: string, make: () => DataAdapter): void {
  describe(label, () => {
    test("create returns a versioned record and reads it back", async () => {
      const db = make();
      const record = await db.create(ENTITY, { exercise: "Squat", weight: 100, reps: 5 }, { entityRevision: REVISION });
      expect(record.entityId).toBe(ENTITY);
      expect(record.entityRevision).toBe(REVISION);
      expect(typeof record.version).toBe("string");
      expect(record.version).not.toBe("");
      expect(record.values).toEqual({ exercise: "Squat", weight: 100, reps: 5 });
      const one = await db.findOne(ENTITY, record.id);
      expect(one?.values).toEqual({ exercise: "Squat", weight: 100, reps: 5 });
      expect(one?.version).toBe(record.version);
    });

    test("a missing record reads back as null and an unknown entity lists as empty", async () => {
      const db = make();
      expect(await db.findOne(ENTITY, "does-not-exist")).toBeNull();
      expect(await db.findOne("unknown-entity", "1")).toBeNull();
      const page = await db.find("unknown-entity", {});
      expect(page.items).toHaveLength(0);
      expect(page.total).toBe(0);
    });

    test("find counts every matching record and pages", async () => {
      const db = make();
      for (const weight of [80, 100, 60]) {
        await db.create(ENTITY, { exercise: "Squat", weight, reps: 5 }, { entityRevision: REVISION });
      }
      const all = await db.find(ENTITY, {});
      expect(all.total).toBe(3);
      expect(all.items).toHaveLength(3);
      const paged = await db.find(ENTITY, { page: { offset: 1, limit: 1 } });
      expect(paged.total).toBe(3);
      expect(paged.items).toHaveLength(1);
    });

    test("an empty date matches neither gte nor lte, so a date-range filter excludes undated records", async () => {
      const db = make();
      await db.create(ENTITY, { exercise: "Dated", due: "2026-10-15" }, { entityRevision: REVISION });
      await db.create(ENTITY, { exercise: "Cleared", due: "2026-10-16" }, { entityRevision: REVISION });
      await db.create(ENTITY, { exercise: "Blank", due: "" }, { entityRevision: REVISION });
      await db.create(ENTITY, { exercise: "Missing" }, { entityRevision: REVISION });
      const cleared = (await db.find(ENTITY, { filter: { op: "eq", field: "exercise", value: "Cleared" } })).items[0];
      await db.update(ENTITY, cleared?.id ?? "", { due: null }, { entityRevision: REVISION, baseVersion: cleared?.version ?? "" });
      const names = async (filter: Condition) => (await db.find(ENTITY, { filter })).items.map((r) => r.values["exercise"]).sort();
      expect(await names({ op: "gte", field: "due", value: "0000-01-01" })).toEqual(["Dated"]);
      expect(await names({ op: "lte", field: "due", value: "9999-12-31" })).toEqual(["Dated"]);
      expect(
        await names({
          op: "and",
          conditions: [
            { op: "gte", field: "due", value: "2026-10-01" },
            { op: "lte", field: "due", value: "2026-10-31" },
          ],
        }),
      ).toEqual(["Dated"]);
      expect(await names({ op: "empty", field: "due" })).toEqual(["Blank", "Cleared", "Missing"]);
    });

    // RFC 0007: datetime compares and sorts as canonical strings (string order
    // is time order), and an instant-range quick filter's "to" bound is the
    // last millisecond of its minute, so 10:00 to 10:30 includes 10:30:59.999.
    test("datetime filters compare canonical instants, and empties match neither bound", async () => {
      const db = make();
      await db.create(ENTITY, { exercise: "At", when: "2026-10-15T09:30:00.000Z" }, { entityRevision: REVISION });
      await db.create(ENTITY, { exercise: "After", when: "2026-10-15T09:30:00.001Z" }, { entityRevision: REVISION });
      await db.create(ENTITY, { exercise: "Before", when: "2026-10-15T09:29:59.999Z" }, { entityRevision: REVISION });
      await db.create(ENTITY, { exercise: "Cleared", when: "2026-10-15T09:30:00.500Z" }, { entityRevision: REVISION });
      await db.create(ENTITY, { exercise: "Missing" }, { entityRevision: REVISION });
      const cleared = (await db.find(ENTITY, { filter: { op: "eq", field: "exercise", value: "Cleared" } })).items[0];
      await db.update(ENTITY, cleared?.id ?? "", { when: null }, { entityRevision: REVISION, baseVersion: cleared?.version ?? "" });
      const names = async (filter: Condition) => (await db.find(ENTITY, { filter })).items.map((r) => r.values["exercise"]).sort();
      const at = "2026-10-15T09:30:00.000Z";
      expect(await names({ op: "eq", field: "when", value: at })).toEqual(["At"]);
      // neq is the evaluator's `!==`: an empty value differs from the instant,
      // so it matches (exactly as it does for date fields).
      expect(await names({ op: "neq", field: "when", value: at })).toEqual(["After", "Before", "Cleared", "Missing"]);
      expect(await names({ op: "in", field: "when", values: [at, "2026-10-15T09:29:59.999Z"] })).toEqual(["At", "Before"]);
      expect(await names({ op: "gt", field: "when", value: at })).toEqual(["After"]);
      expect(await names({ op: "gte", field: "when", value: at })).toEqual(["After", "At"]);
      expect(await names({ op: "lt", field: "when", value: at })).toEqual(["Before"]);
      expect(await names({ op: "lte", field: "when", value: at })).toEqual(["At", "Before"]);
      // An empty value (null or missing) is above and below nothing.
      expect(await names({ op: "gte", field: "when", value: "0000-01-01T00:00:00.000Z" })).toEqual(["After", "At", "Before"]);
      expect(await names({ op: "lte", field: "when", value: "9999-12-31T23:59:59.999Z" })).toEqual(["After", "At", "Before"]);
      expect(await names({ op: "empty", field: "when" })).toEqual(["Cleared", "Missing"]);
      expect(await names({ op: "notEmpty", field: "when" })).toEqual(["After", "At", "Before"]);
      // The range a from/to quick filter compiles to includes the last
      // millisecond of the "to" minute; an instant one millisecond past it
      // does not match.
      const range = instantRangeBounds("2026-10-15T09:29", "2026-10-15T09:30", "UTC");
      expect(range).toEqual({ from: "2026-10-15T09:29:00.000Z", to: "2026-10-15T09:30:59.999Z" });
      expect(
        await names({
          op: "and",
          conditions: [
            { op: "gte", field: "when", value: range.from },
            { op: "lte", field: "when", value: range.to },
          ],
        }),
      ).toEqual(["After", "At", "Before"]);
    });

    test("datetime sorts as string order (time order), with empties last in both directions", async () => {
      const db = make();
      const instants = [
        "2026-10-15T09:00:00.099Z",
        "2026-10-15T09:00:00.100Z",
        "2026-10-15T09:00:09.999Z",
        "2026-10-15T09:00:10.000Z",
        "2026-10-15T10:00:00.000Z",
      ];
      for (const [i, instant] of instants.entries()) {
        await db.create(ENTITY, { exercise: `n${i}`, when: instant }, { entityRevision: REVISION });
      }
      await db.create(ENTITY, { exercise: "Cleared", when: "2026-10-15T09:30:00.000Z" }, { entityRevision: REVISION });
      await db.create(ENTITY, { exercise: "Missing" }, { entityRevision: REVISION });
      const cleared = (await db.find(ENTITY, { filter: { op: "eq", field: "exercise", value: "Cleared" } })).items[0];
      await db.update(ENTITY, cleared?.id ?? "", { when: null }, { entityRevision: REVISION, baseVersion: cleared?.version ?? "" });
      const expectOrder = (dir: "asc" | "desc") => {
        const page = db.find(ENTITY, { sort: [{ field: "when", dir }] });
        return page.then((p) => p.items.map((r) => r.values["exercise"]));
      };
      await expect(expectOrder("asc")).resolves.toEqual(["n0", "n1", "n2", "n3", "n4", "Cleared", "Missing"]);
      await expect(expectOrder("desc")).resolves.toEqual(["n4", "n3", "n2", "n1", "n0", "Cleared", "Missing"]);
    });

    test("find sorts by a field", async () => {
      const db = make();
      await db.create(ENTITY, { exercise: "Bench", weight: 80 }, { entityRevision: REVISION });
      await db.create(ENTITY, { exercise: "Squat", weight: 100 }, { entityRevision: REVISION });
      await db.create(ENTITY, { exercise: "Deadlift", weight: 60 }, { entityRevision: REVISION });
      const page = await db.find(ENTITY, { sort: [{ field: "weight", dir: "desc" }] });
      expect(page.items.map((r) => r.values["exercise"])).toEqual(["Squat", "Bench", "Deadlift"]);
    });

    test("update bumps the version, merges values and stamps the revision", async () => {
      const db = make();
      const created = await db.create(ENTITY, { exercise: "Squat", weight: 100, reps: 5 }, { entityRevision: REVISION });
      const updated = await db.update(ENTITY, created.id, { weight: 102.5 }, { entityRevision: REVISION + 1, baseVersion: created.version });
      expect(updated.version).not.toBe(created.version);
      expect(updated.values).toEqual({ exercise: "Squat", weight: 102.5, reps: 5 });
      expect(updated.entityRevision).toBe(REVISION + 1);
    });

    test("a partial update leaves omitted fields and clears an explicit null", async () => {
      const db = make();
      const created = await db.create(ENTITY, { exercise: "Squat", weight: 100, reps: 5 }, { entityRevision: REVISION });
      const updated = await db.update(ENTITY, created.id, { reps: null }, { entityRevision: REVISION, baseVersion: created.version });
      expect(updated.values).toEqual({ exercise: "Squat", weight: 100, reps: null });
    });

    test("an empty patch is a no-op that keeps the version, but a stale baseVersion still conflicts", async () => {
      const db = make();
      const created = await db.create(ENTITY, { exercise: "Squat", weight: 100 }, { entityRevision: REVISION });
      const same = await db.update(ENTITY, created.id, {}, { entityRevision: REVISION, baseVersion: created.version });
      expect(same.version).toBe(created.version);
      expect(same.values).toEqual(created.values);
      await db.update(ENTITY, created.id, { weight: 120 }, { entityRevision: REVISION, baseVersion: created.version });
      const conflict = await expectError(db.update(ENTITY, created.id, {}, { entityRevision: REVISION, baseVersion: created.version }));
      expect(conflict).toBeInstanceOf(RecordConflictError);
    });

    test("an update against a stale baseVersion conflicts and carries the current record", async () => {
      const db = make();
      const created = await db.create(ENTITY, { exercise: "Squat", weight: 100 }, { entityRevision: REVISION });
      const current = await db.update(ENTITY, created.id, { weight: 120 }, { entityRevision: REVISION + 1, baseVersion: created.version });
      const conflict = (await expectError(db.update(ENTITY, created.id, { reps: 1 }, { entityRevision: REVISION + 1, baseVersion: created.version }))) as RecordConflictError;
      expect(conflict).toBeInstanceOf(RecordConflictError);
      expect(conflict.current?.values).toEqual(current.values);
    });

    test("an update of a missing record is a not-found error", async () => {
      const db = make();
      const error = await expectError(db.update(ENTITY, "does-not-exist", { weight: 1 }, { entityRevision: REVISION }));
      expect(error).toBeInstanceOf(RecordNotFoundError);
    });

    test("a write naming an unknown field id is a validation error", async () => {
      const db = make();
      const createError = await expectError(db.create(ENTITY, { exercise: "Squat", bogus: 1 }, { entityRevision: REVISION }));
      expect(createError).toBeInstanceOf(RecordValidationError);
      const created = await db.create(ENTITY, { exercise: "Squat", weight: 100 }, { entityRevision: REVISION });
      const updateError = await expectError(db.update(ENTITY, created.id, { bogus: 1 }, { entityRevision: REVISION + 1, baseVersion: created.version }));
      expect(updateError).toBeInstanceOf(RecordValidationError);
    });

    test("delete removes the record and a stale baseVersion conflicts", async () => {
      const db = make();
      const created = await db.create(ENTITY, { exercise: "Squat", weight: 100 }, { entityRevision: REVISION });
      const stale = created.version;
      const current = await db.update(ENTITY, created.id, { weight: 120 }, { entityRevision: REVISION + 1, baseVersion: created.version });
      const conflict = await expectError(db.delete(ENTITY, created.id, { entityRevision: REVISION, baseVersion: stale }));
      expect(conflict).toBeInstanceOf(RecordConflictError);
      expect(await db.findOne(ENTITY, created.id)).not.toBeNull();
      await db.delete(ENTITY, created.id, { entityRevision: REVISION, baseVersion: current.version });
      expect(await db.findOne(ENTITY, created.id)).toBeNull();
    });

    test("a delete of a missing record is a not-found error", async () => {
      const db = make();
      const error = await expectError(db.delete(ENTITY, "does-not-exist", { entityRevision: REVISION }));
      expect(error).toBeInstanceOf(RecordNotFoundError);
    });

    test("batch creates and deletes in one atomic step", async () => {
      const db = make();
      const keep = await db.create(ENTITY, { exercise: "Squat", weight: 100 }, { entityRevision: REVISION });
      const drop = await db.create(ENTITY, { exercise: "Bench", weight: 80 }, { entityRevision: REVISION });
      const result = await db.batch(
        ENTITY,
        { create: [{ exercise: "Deadlift", weight: 60 }], delete: [{ id: drop.id, baseVersion: drop.version }] },
        { entityRevision: REVISION + 1 },
      );
      expect(result.created).toHaveLength(1);
      expect(result.created[0]?.values).toEqual({ exercise: "Deadlift", weight: 60 });
      expect(result.deleted).toEqual([drop.id]);
      const all = await db.find(ENTITY, {});
      expect(all.total).toBe(2);
      expect(all.items.some((r) => r.id === keep.id)).toBe(true);
      expect(all.items.some((r) => r.id === drop.id)).toBe(false);
    });

    test("batch is all-or-nothing when a create is invalid", async () => {
      const db = make();
      const keep = await db.create(ENTITY, { exercise: "Squat", weight: 100 }, { entityRevision: REVISION });
      const error = await expectError(
        db.batch(ENTITY, { create: [{ exercise: "Bench", weight: 80, bogus: 1 }], delete: [{ id: keep.id }] }, { entityRevision: REVISION + 1 }),
      );
      expect(error).toBeInstanceOf(RecordValidationError);
      const all = await db.find(ENTITY, {});
      expect(all.total).toBe(1);
      expect(all.items.some((r) => r.id === keep.id)).toBe(true);
    });
  });
}

runConformance("memory adapter", () => createMemoryAdapter(FIELDS));
runConformance("key-value adapter", () => createKeyValueAdapter(freshStore(), "app", FIELDS));
runConformance("http adapter", () => makeFakeServer(FIELDS).adapter);

describe("http adapter: request encoding and status mapping", () => {
  test("find encodes filter, sort and paging as a query string and sends credentials", async () => {
    const { adapter, requests } = makeFakeServer(FIELDS);
    const filter = { op: "eq", field: "exercise", value: "Squat" } as const;
    const sort = [{ field: "weight", dir: "desc" as const }];
    await adapter.find(ENTITY, { filter, sort, page: { offset: 0, limit: 1 } });
    const request = requests.find((r) => r.method === "GET" && r.path === `/${ENTITY}`);
    expect(request?.query["filter"]).toBe(JSON.stringify(filter));
    expect(request?.query["sort"]).toBe(JSON.stringify(sort));
    expect(request?.query["offset"]).toBe("0");
    expect(request?.query["limit"]).toBe("1");
    expect(request?.credentials).toBe("same-origin");
    expect(request?.headers?.["Accept"]).toBe("application/json");
  });

  test("a create sends the values and entity revision in a POST body", async () => {
    const { adapter, requests } = makeFakeServer(FIELDS);
    await adapter.create(ENTITY, { exercise: "Squat", weight: 1 }, { entityRevision: 7 });
    const request = requests.find((r) => r.method === "POST" && r.path === `/${ENTITY}`);
    expect(request?.body).toEqual({ values: { exercise: "Squat", weight: 1 }, entityRevision: 7 });
    expect(request?.headers?.["Content-Type"]).toBe("application/json");
  });

  test("an update sends baseVersion and a delete sends it as a query param", async () => {
    const { adapter, requests } = makeFakeServer(FIELDS);
    const created = await adapter.create(ENTITY, { exercise: "Squat" }, { entityRevision: REVISION });
    const updated = await adapter.update(ENTITY, created.id, { weight: 90 }, { entityRevision: REVISION, baseVersion: created.version });
    const patch = requests.find((r) => r.method === "PATCH");
    expect(patch?.body).toEqual({ values: { weight: 90 }, entityRevision: REVISION, baseVersion: created.version });
    await adapter.delete(ENTITY, created.id, { entityRevision: REVISION, baseVersion: updated.version });
    const del = requests.find((r) => r.method === "DELETE");
    expect(del?.path).toBe(`/${ENTITY}/${created.id}`);
    expect(del?.query["baseVersion"]).toBe(updated.version);
  });

  test("a batch wraps each create in values and posts to _batch", async () => {
    const { adapter, requests } = makeFakeServer(FIELDS);
    const created = await adapter.create(ENTITY, { exercise: "Squat" }, { entityRevision: REVISION });
    await adapter.batch(
      ENTITY,
      { create: [{ exercise: "Bench", weight: 80 }], delete: [{ id: created.id, baseVersion: created.version }] },
      { entityRevision: REVISION + 1 },
    );
    const request = requests.find((r) => r.method === "POST" && r.path === `/${ENTITY}/_batch`);
    expect(request?.body).toEqual({
      entityRevision: REVISION + 1,
      create: [{ values: { exercise: "Bench", weight: 80 } }],
      delete: [{ id: created.id, baseVersion: created.version }],
    });
  });

  test("maps status codes to the typed errors and a 409 carries the current record", async () => {
    const server = makeFakeServer(FIELDS);
    const adapter = server.adapter;
    const created = await adapter.create(ENTITY, { exercise: "Squat" }, { entityRevision: REVISION });
    await adapter.update(ENTITY, created.id, { weight: 1 }, { entityRevision: REVISION, baseVersion: created.version });
    const conflict = (await expectError(
      adapter.update(ENTITY, created.id, { weight: 2 }, { entityRevision: REVISION, baseVersion: created.version }),
    )) as RecordConflictError;
    expect(conflict).toBeInstanceOf(RecordConflictError);
    expect(conflict.current?.values).toEqual({ exercise: "Squat", weight: 1 });

    const status = (code: number, extraCode: string): FetchLike => async () => ({
      status: code,
      json: async () => ({ errors: [{ path: "", code: extraCode, message: "Nope.", hint: "Try again." }] }),
    });
    const unauthorized = createHttpAdapter({ baseUrl: "/api/records", fetch: status(401, "unauthorized") });
    expect(await expectError(unauthorized.findOne(ENTITY, "1"))).toBeInstanceOf(UnauthorizedError);
    const forbidden = createHttpAdapter({ baseUrl: "/api/records", fetch: status(403, "forbidden") });
    expect(await expectError(forbidden.findOne(ENTITY, "1"))).toBeInstanceOf(ForbiddenError);
    const notFound = createHttpAdapter({ baseUrl: "/api/records", fetch: status(404, "not-found") });
    expect(await notFound.findOne(ENTITY, "1")).toBeNull();
  });

  test("onUnauthorized is called on a 401 and the call still rejects", async () => {
    let calls = 0;
    const fetch: FetchLike = async (_input, _init) => ({ status: 401, json: async () => ({ errors: [{ path: "", code: "unauthorized", message: "Sign in.", hint: "Sign in." }] }) });
    const adapter = createHttpAdapter({ baseUrl: "/api/records", fetch, onUnauthorized: () => void calls++ });
    expect(await expectError(adapter.find(ENTITY, {}))).toBeInstanceOf(UnauthorizedError);
    expect(calls).toBe(1);
    const forbidden = createHttpAdapter({ baseUrl: "/api/records", fetch: async () => ({ status: 403, json: async () => ({}) }), onUnauthorized: () => void calls++ });
    await expectError(forbidden.find(ENTITY, {}));
    expect(calls).toBe(1);
  });

  test("a 409 without a JSON body is still a conflict, with no current record", async () => {
    const noBody: FetchLike = async () => ({
      status: 409,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    });
    const adapter = createHttpAdapter({ baseUrl: "/api/records", fetch: noBody });
    const conflict = (await expectError(adapter.update(ENTITY, "1", { weight: 1 }, { entityRevision: REVISION, baseVersion: "v1" }))) as RecordConflictError;
    expect(conflict).toBeInstanceOf(RecordConflictError);
    expect(conflict.current).toBeNull();
  });
});

// --- per-record permissions and viewer conditions in queries (RFC 0006) ---

const LOCKED = (record: { values: RecordValues }) => (record.values["exercise"] === "Locked" ? { update: false, delete: false } : undefined);
const VIEWER_FILTER: Condition = { op: "and", conditions: [{ op: "empty", field: "reps" }, { op: "not", condition: { op: "viewerIn", fact: "role", values: ["owner"] } }] };

function runPermissionConformance(label: string, make: (options: AdapterOptions) => DataAdapter): void {
  describe(`${label}: record permissions`, () => {
    const options: AdapterOptions = { ...FIELDS, recordPermissions: LOCKED };

    test("every record read carries the stated can, and unrestricted records carry none", async () => {
      const db = make(options);
      const locked = await db.create(ENTITY, { exercise: "Locked" }, { entityRevision: REVISION });
      const open = await db.create(ENTITY, { exercise: "Open" }, { entityRevision: REVISION });
      expect(locked.can).toEqual({ update: false, delete: false });
      expect(open.can).toBeUndefined();
      expect((await db.findOne(ENTITY, locked.id))?.can).toEqual({ update: false, delete: false });
      const page = await db.find(ENTITY, {});
      expect(page.items.map((r) => r.can)).toEqual([{ update: false, delete: false }, undefined]);
    });

    test("updating or deleting a locked record is a ForbiddenError, an open one works", async () => {
      const db = make(options);
      const locked = await db.create(ENTITY, { exercise: "Locked" }, { entityRevision: REVISION });
      const open = await db.create(ENTITY, { exercise: "Open" }, { entityRevision: REVISION });
      expect(await expectError(db.update(ENTITY, locked.id, { weight: 1 }, { entityRevision: REVISION, baseVersion: locked.version }))).toBeInstanceOf(ForbiddenError);
      expect(await expectError(db.delete(ENTITY, locked.id, { entityRevision: REVISION }))).toBeInstanceOf(ForbiddenError);
      expect(await expectError(db.batch(ENTITY, { delete: [{ id: locked.id }, { id: open.id }] }, { entityRevision: REVISION }))).toBeInstanceOf(ForbiddenError);
      expect((await db.find(ENTITY, {})).total).toBe(2);
      const saved = await db.update(ENTITY, open.id, { weight: 5 }, { entityRevision: REVISION, baseVersion: open.version });
      expect(saved.values["weight"]).toBe(5);
      await db.delete(ENTITY, open.id, { entityRevision: REVISION });
      expect((await db.find(ENTITY, {})).total).toBe(1);
    });

    test("an unrestricted adapter states no can", async () => {
      const db = make(FIELDS);
      const record = await db.create(ENTITY, { exercise: "Locked" }, { entityRevision: REVISION });
      expect("can" in record).toBe(false);
    });
  });

  describe(`${label}: viewer conditions in queries`, () => {
    test("a viewerIn leaf anywhere in a filter is a validation error at /filter", async () => {
      const db = make(FIELDS);
      for (const filter of [VIEWER_FILTER, { op: "viewerIn", fact: "role", values: ["owner"] } as Condition]) {
        const error = (await expectError(db.find(ENTITY, { filter }))) as RecordValidationError;
        expect(error).toBeInstanceOf(RecordValidationError);
        expect(error.issues.map((i) => [i.path, i.code])).toEqual([["/filter", "invalid-value"]]);
      }
    });
  });
}

runPermissionConformance("memory adapter", (o) => createMemoryAdapter(o));
runPermissionConformance("key-value adapter", (o) => createKeyValueAdapter(freshStore(), "app", o));
runPermissionConformance("http adapter", (o) => makeFakeServer(o).adapter);

// --- record actions on the in-process adapters (RFC 0007, card 34f) ---

const ACTORS: Record<string, ActionHandler> = {
  "set.stamp": (record, input) => ({ values: { reps: (record.values["reps"] as number) + (input["delta"] as number) } }),
  "set.archive": () => ({ remove: true }),
  "set.conflict": () => {
    throw new RecordConflictError("no longer applicable", null);
  },
  "set.noop": () => ({}),
};
const ACT_OPTIONS: AdapterOptions = { ...FIELDS, actions: ACTORS };
const PERMISSIONED = (record: { values: RecordValues }): RecordPermissions | undefined =>
  record.values["exercise"] === "Guarded" ? { actions: { stamp: false } } : undefined;
const GUARDED_OPTIONS: AdapterOptions = { ...ACT_OPTIONS, recordPermissions: PERMISSIONED };

function runActionConformance(label: string, make: (options: AdapterOptions) => DataAdapter): void {
  describe(`${label}: record actions`, () => {
    test("a values outcome patches with a fresh version and returns the stored record (200)", async () => {
      const db = make(ACT_OPTIONS);
      const record = await db.create(ENTITY, { exercise: "Squat", reps: 5 }, { entityRevision: REVISION });
      const acted = await db.act!(ENTITY, record.id, "stamp", { input: { delta: 2 }, meta: { entityRevision: REVISION, baseVersion: record.version } });
      expect(acted?.values["reps"]).toBe(7);
      expect(acted?.version).not.toBe(record.version);
      expect((await db.findOne(ENTITY, record.id))?.values["reps"]).toBe(7);
    });

    test("a remove outcome deletes and returns null (204)", async () => {
      const db = make(ACT_OPTIONS);
      const record = await db.create(ENTITY, { exercise: "Squat" }, { entityRevision: REVISION });
      const acted = await db.act!(ENTITY, record.id, "archive", { meta: { entityRevision: REVISION, baseVersion: record.version } });
      expect(acted).toBeNull();
      expect(await db.findOne(ENTITY, record.id)).toBeNull();
    });

    test("an empty outcome is a no-op patch: the record survives with a fresh version", async () => {
      const db = make(ACT_OPTIONS);
      const record = await db.create(ENTITY, { exercise: "Squat" }, { entityRevision: REVISION });
      const acted = await db.act!(ENTITY, record.id, "noop", { meta: { entityRevision: REVISION, baseVersion: record.version } });
      expect(acted?.values["exercise"]).toBe("Squat");
    });

    test("an unknown action is a RecordNotFoundError, checked before the record", async () => {
      const db = make(ACT_OPTIONS);
      await expectInstanceOf(db.act!(ENTITY, "nope", "ghost", { meta: { entityRevision: REVISION, baseVersion: "x" } }), RecordNotFoundError);
      await expectInstanceOf(db.act!(ENTITY, "nope", "stamp", { meta: { entityRevision: REVISION, baseVersion: "x" } }), RecordNotFoundError);
    });

    test("a stale baseVersion is a RecordConflictError carrying the current record", async () => {
      const db = make(ACT_OPTIONS);
      const record = await db.create(ENTITY, { exercise: "Squat", reps: 1 }, { entityRevision: REVISION });
      const saved = await db.update(ENTITY, record.id, { reps: 2 }, { entityRevision: REVISION, baseVersion: record.version });
      const error = (await expectError(
        db.act!(ENTITY, record.id, "stamp", { input: { delta: 1 }, meta: { entityRevision: REVISION, baseVersion: record.version } }),
      )) as RecordConflictError;
      expect(error).toBeInstanceOf(RecordConflictError);
      expect(error.current?.values["reps"]).toBe(2);
      expect(error.current?.version).toBe(saved.version);
    });

    test("can.actions[id] false is a ForbiddenError, and the check comes after the version check", async () => {
      const db = make(GUARDED_OPTIONS);
      const guarded = await db.create(ENTITY, { exercise: "Guarded", reps: 1 }, { entityRevision: REVISION });
      await expectInstanceOf(
        db.act!(ENTITY, guarded.id, "stamp", { input: { delta: 1 }, meta: { entityRevision: REVISION, baseVersion: guarded.version } }),
        ForbiddenError,
      );
      // Stale version wins over forbidden: the current record comes back.
      const changed = await db.update(ENTITY, guarded.id, { reps: 2 }, { entityRevision: REVISION, baseVersion: guarded.version });
      const error = (await expectError(
        db.act!(ENTITY, guarded.id, "stamp", { input: { delta: 1 }, meta: { entityRevision: REVISION, baseVersion: guarded.version } }),
      )) as RecordConflictError;
      expect(error).toBeInstanceOf(RecordConflictError);
      expect(error.current?.version).toBe(changed.version);
    });

    test("a handler-thrown RecordConflictError passes through", async () => {
      const db = make(ACT_OPTIONS);
      const record = await db.create(ENTITY, { exercise: "Squat" }, { entityRevision: REVISION });
      const error = (await expectError(
        db.act!(ENTITY, record.id, "conflict", { meta: { entityRevision: REVISION, baseVersion: record.version } }),
      )) as RecordConflictError;
      expect(error).toBeInstanceOf(RecordConflictError);
      expect(error.message).toBe("no longer applicable");
    });

    test("the handler sees the record with permissions applied", async () => {
      let seen: DataRecord | undefined;
      const db = make({ ...GUARDED_OPTIONS, actions: { ...ACTORS, "set.peep": (record) => ((seen = record), { values: {} }) } });
      const guarded = await db.create(ENTITY, { exercise: "Guarded", reps: 1 }, { entityRevision: REVISION });
      await db.act!(ENTITY, guarded.id, "peep", { meta: { entityRevision: REVISION, baseVersion: guarded.version } });
      expect(seen?.can).toEqual({ actions: { stamp: false } });
    });

    test("an adapter without the actions option has no act at all", async () => {
      const db = make(FIELDS);
      expect(db.act).toBeUndefined();
    });
  });
}

async function expectInstanceOf(promise: Promise<unknown>, type: new (...args: never[]) => Error): Promise<void> {
  const error = await expectError(promise);
  if (!(error instanceof type)) throw new Error(`expected ${type.name}, got ${String(error)}`);
}

runActionConformance("memory adapter", (o) => createMemoryAdapter(o));
runActionConformance("key-value adapter", (o) => createKeyValueAdapter(freshStore(), "app", o));

describe("http adapter: act on the wire", () => {
  const acted: DataRecord = { id: "s12", entityId: ENTITY, entityRevision: REVISION, version: "9", values: { exercise: "Squat", reps: 7 } };
  const reply = (status: number, payload?: unknown): { fetch: FetchLike; calls: { url: string; body?: string }[] } => {
    const calls: { url: string; body?: string }[] = [];
    return {
      calls,
      fetch: async (url, init) => {
        calls.push({ url, ...(init?.body !== undefined ? { body: init.body } : {}) });
        return { status, json: async () => payload };
      },
    };
  };
  const request = { input: { delta: 2 }, meta: { entityRevision: REVISION, baseVersion: "7" } };

  test("posts input, entityRevision and baseVersion to the actions path and returns the record on 200", async () => {
    const server = reply(200, acted);
    const db = createHttpAdapter({ baseUrl: "/api/records/", fetch: server.fetch });
    const result = await db.act!(ENTITY, "s12", "stamp", request);
    expect(result).toEqual(acted);
    expect(server.calls[0]?.url).toBe(`/api/records/${ENTITY}/s12/actions/stamp`);
    expect(JSON.parse(server.calls[0]?.body ?? "{}")).toEqual({ input: { delta: 2 }, entityRevision: REVISION, baseVersion: "7" });
  });

  test("no input sends an empty object; a 204 returns null", async () => {
    const server = reply(204);
    const db = createHttpAdapter({ baseUrl: "/api/records", fetch: server.fetch });
    expect(await db.act!(ENTITY, "s12", "archive", { meta: { entityRevision: REVISION, baseVersion: "7" } })).toBeNull();
    expect(JSON.parse(server.calls[0]?.body ?? "{}")).toEqual({ input: {}, entityRevision: REVISION, baseVersion: "7" });
  });

  test("400 with /input paths is a RecordValidationError, 403 a ForbiddenError, 404 a RecordNotFoundError, 409 a RecordConflictError with current", async () => {
    const bad = reply(400, { errors: [{ path: "/input/delta", code: "type", message: "Nope.", hint: "Numbers only." }] });
    expect(await expectError(createHttpAdapter({ baseUrl: "/b", fetch: bad.fetch }).act!(ENTITY, "x", "a", request))).toBeInstanceOf(RecordValidationError);
    const issues = (await expectError(createHttpAdapter({ baseUrl: "/b", fetch: bad.fetch }).act!(ENTITY, "x", "a", request))) as RecordValidationError;
    expect(issues.issues.map((i) => [i.path, i.code])).toEqual([["/input/delta", "type"]]);

    const forbidden = reply(403, { errors: [{ path: "", code: "forbidden", message: "Not allowed.", hint: "Ask." }] });
    expect(await expectError(createHttpAdapter({ baseUrl: "/b", fetch: forbidden.fetch }).act!(ENTITY, "x", "a", request))).toBeInstanceOf(ForbiddenError);

    const missing = reply(404, { errors: [{ path: "", code: "not-found", message: "No such action.", hint: "Check." }] });
    expect(await expectError(createHttpAdapter({ baseUrl: "/b", fetch: missing.fetch }).act!(ENTITY, "x", "a", request))).toBeInstanceOf(RecordNotFoundError);

    const stale = reply(409, { errors: [{ path: "/baseVersion", code: "conflict", message: "Stale.", hint: "Reload." }], current: acted });
    const conflict = (await expectError(createHttpAdapter({ baseUrl: "/b", fetch: stale.fetch }).act!(ENTITY, "x", "a", request))) as RecordConflictError;
    expect(conflict).toBeInstanceOf(RecordConflictError);
    expect(conflict.current?.version).toBe("9");
  });

  test("the record act returns passes the same can validation as every other read", async () => {
    const valid = reply(200, { ...acted, can: { actions: { stamp: false } } });
    const kept = await createHttpAdapter({ baseUrl: "/b", fetch: valid.fetch }).act!(ENTITY, "s12", "stamp", request);
    expect(kept?.can).toEqual({ actions: { stamp: false } });
    const malformed = reply(200, { ...acted, can: { actions: { stamp: "no" } } });
    const dropped = await createHttpAdapter({ baseUrl: "/b", fetch: malformed.fetch }).act!(ENTITY, "s12", "stamp", request);
    expect(dropped !== null && dropped !== undefined && "can" in dropped).toBe(false);
  });

  test("the http adapter always offers act", () => {
    expect(createHttpAdapter({ baseUrl: "/b", fetch: reply(200, acted).fetch }).act).toBeDefined();
  });
});

describe("http adapter: can on the wire", () => {
  const record = (can: unknown) => ({ id: "1", entityId: ENTITY, entityRevision: REVISION, version: "v1", values: { exercise: "Squat" }, can });
  const serving = (payload: unknown): FetchLike => async () => ({ status: 200, json: async () => payload });

  test("a valid can passes through on a list, a get, a write and the current record of a 409", async () => {
    const can = { update: false };
    const adapter = createHttpAdapter({ baseUrl: "/api/records", fetch: serving(record(can)) });
    expect((await adapter.findOne(ENTITY, "1"))?.can).toEqual(can);
    expect((await adapter.update(ENTITY, "1", { weight: 1 }, { entityRevision: REVISION })).can).toEqual(can);
    expect((await adapter.create(ENTITY, {}, { entityRevision: REVISION })).can).toEqual(can);
    const list = createHttpAdapter({ baseUrl: "/api/records", fetch: serving({ items: [record(can)], total: 1 }) });
    expect((await list.find(ENTITY, {})).items[0]?.can).toEqual(can);
    const conflicting = createHttpAdapter({ baseUrl: "/api/records", fetch: async () => ({ status: 409, json: async () => ({ errors: [], current: record(can) }) }) });
    const failure = (await expectError(conflicting.update(ENTITY, "1", {}, { entityRevision: REVISION }))) as RecordConflictError;
    expect(failure.current?.can).toEqual(can);
  });

  test("a malformed can is dropped, never an error", async () => {
    for (const bad of ["no", null, [], { update: "yes" }, { update: false, share: true }, { delete: 1 }]) {
      const adapter = createHttpAdapter({ baseUrl: "/api/records", fetch: serving({ items: [record(bad)], total: 1 }) });
      const item = (await adapter.find(ENTITY, {})).items[0];
      expect(item?.id).toBe("1");
      expect(item !== undefined && "can" in item).toBe(false);
    }
  });

  test("a viewerIn filter never reaches the wire", async () => {
    let calls = 0;
    const adapter = createHttpAdapter({ baseUrl: "/api/records", fetch: async () => (calls++, { status: 200, json: async () => ({ items: [], total: 0 }) }) });
    expect(await expectError(adapter.find(ENTITY, { filter: VIEWER_FILTER }))).toBeInstanceOf(RecordValidationError);
    expect(calls).toBe(0);
  });
});

// RFC 0007: a server that never counts answers with `next` and no `total`.
// The in-process adapters imitate one with `paging: "cursor"`; the HTTP path
// rides the same paging through the fake server, so all three share the check.
describe("paging without a total", () => {
  const cursorOptions: AdapterOptions = { ...FIELDS, paging: "cursor" };
  const factories: readonly [string, () => DataAdapter, () => DataAdapter][] = [
    ["memory adapter", () => createMemoryAdapter(cursorOptions), () => createMemoryAdapter(FIELDS)],
    ["key-value adapter", () => createKeyValueAdapter(freshStore(), "app", cursorOptions), () => createKeyValueAdapter(freshStore(), "app", FIELDS)],
    ["http adapter", () => makeFakeServer(cursorOptions).adapter, () => makeFakeServer(FIELDS).adapter],
  ];

  for (const [label, make, makeDefault] of factories) {
    describe(label, () => {
      const seed = async (count: number): Promise<DataAdapter> => {
        const db = make();
        for (let i = 0; i < count; i++) await db.create(ENTITY, { exercise: `e${String(i).padStart(3, "0")}`, weight: i }, { entityRevision: REVISION });
        return db;
      };

      test("pages carry no total and an opaque next until the end", async () => {
        const db = await seed(7);
        const seen: string[] = [];
        let cursor: string | null | undefined;
        for (let guard = 0; guard < 10; guard++) {
          // the first request is offset 0 (RFC 0007: "no cursor and offset 0"); the rest follow `next`
          const nextCursor = cursor;
          const page = await db.find(ENTITY, {
            sort: [{ field: "weight", dir: "asc" }],
            page: nextCursor === undefined || nextCursor === null ? { offset: 0, limit: 3 } : { cursor: nextCursor, limit: 3 },
          });
          expect("total" in page).toBe(false);
          seen.push(...page.items.map((r) => r.values["exercise"] as string));
          cursor = page.next ?? null;
          if (cursor === null) break;
          expect(typeof cursor).toBe("string");
        }
        expect(seen).toHaveLength(7);
        expect(new Set(seen).size).toBe(7);
      });

      test("an exact-page boundary ends with next null, not an empty extra page", async () => {
        const db = await seed(6);
        const first = await db.find(ENTITY, { sort: [{ field: "weight", dir: "asc" }], page: { offset: 0, limit: 3 } });
        expect(first.items).toHaveLength(3);
        expect(first.next).not.toBeNull();
        const second = await db.find(ENTITY, { sort: [{ field: "weight", dir: "asc" }], page: { cursor: first.next ?? "", limit: 3 } });
        expect(second.items).toHaveLength(3);
        expect(second.next ?? null).toBeNull();
      });

      test("limit=0 with no total is an empty page, never a total", async () => {
        const db = await seed(4);
        const page = await db.find(ENTITY, { page: { offset: 0, limit: 0 } });
        expect(page.items).toHaveLength(0);
        expect("total" in page).toBe(false);
      });

      test("the default adapters keep total and page by offset as before", async () => {
        const db = makeDefault();
        for (let i = 0; i < 4; i++) await db.create(ENTITY, { exercise: `e${String(i).padStart(3, "0")}`, weight: i }, { entityRevision: REVISION });
        const page = await db.find(ENTITY, { page: { offset: 1, limit: 2 } });
        expect(page.total).toBe(4);
        expect(page.items).toHaveLength(2);
        expect(page.next ?? null).toBeNull();
      });
    });
  }

  test("the http adapter sends cursor= and never offset= for a cursor page", async () => {
    const { adapter, requests } = makeFakeServer(cursorOptions);
    await adapter.find(ENTITY, { page: { cursor: "c0:abc", limit: 5 } });
    const request = requests.find((r) => r.method === "GET" && r.path === `/${ENTITY}`);
    expect(request?.query["cursor"]).toBe("c0:abc");
    expect(request?.query["offset"]).toBeUndefined();
    expect(request?.query["limit"]).toBe("5");
  });
});
