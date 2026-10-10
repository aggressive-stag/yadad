import { describe, expect, test } from "vitest";
import type { BatchOperations, DataAdapter, Query, RecordValues } from "@yadad/core";
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

const ENTITY = "set";
const FIELDS: AdapterOptions = { fields: { set: ["exercise", "weight", "reps"] } };
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
    const limit = query["limit"];
    return {
      ...(filter !== undefined ? { filter: JSON.parse(filter) } : {}),
      ...(sort !== undefined ? { sort: JSON.parse(sort) } : {}),
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
