// A records-protocol server in one file: node:http for the wire, node:sqlite for storage,
// the entity documents in ../documents for the rules. docs/records-protocol.md in the yadad
// engine is the contract; each section below names the part it implements.
//
// NO AUTHENTICATION: anyone who can reach the port can read and change every record. A real
// app must add sign-in, per-user scoping and CSRF protection; see docs/security.md in the engine.
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { EntityDocument } from "@yadad/core";
import { validateRecord } from "@yadad/runtime";

type Values = Record<string, string | number | boolean | readonly string[] | null>;
type Condition = { op: string; field?: string; value?: unknown; values?: unknown; conditions?: unknown; condition?: unknown };
type Err = { path: string; code: string; message: string; hint: string };
type Row = { rid: number; entity: string; version: number; revision: number; vals: string };

/** An error answer: the status, the protocol's body shape, and `current` on a 409. */
class HttpError extends Error {
  status: number;
  body: object;
  constructor(status: number, errors: Err[], extra: object = {}) {
    super(errors[0]?.message ?? "error");
    this.status = status;
    this.body = { errors, ...extra };
  }
}
const fail = (status: number, path: string, code: string, message: string, hint: string): never => {
  throw new HttpError(status, [{ path, code, message, hint }]);
};

// ---- Storage: one table, values as JSON. Ids come from AUTOINCREMENT, so they are never reused.
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE IF NOT EXISTS records (
    rid INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT NOT NULL, version INTEGER NOT NULL,
    revision INTEGER NOT NULL, vals TEXT NOT NULL)`);
  return db;
}

export function loadEntities(dir: string): Map<string, EntityDocument> {
  const docs = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")));
  return new Map(docs.filter((d) => d.kind === "entity").map((d: EntityDocument) => [d.id, d]));
}

const toRecord = (r: Row) => ({ id: String(r.rid), entityId: r.entity, entityRevision: r.revision, version: String(r.version), values: JSON.parse(r.vals) as Values });

// ---- Filters: the condition AST becomes SQL by whitelist. Field ids are checked against the
// entity, every value is a bound parameter, and an operator not listed here is a 400.
const COMPARE: Record<string, string> = { eq: "=", neq: "IS NOT", gt: ">", gte: ">=", lt: "<", lte: "<=" };
const scalar = (v: unknown, path: string): string | number => {
  if (typeof v === "boolean") return v ? 1 : 0; // json_extract reads booleans as 0 and 1
  if (typeof v === "string" || typeof v === "number") return v;
  return fail(400, path, "invalid-value", "A filter value must be text, a number or true/false.", "Resolve relative dates before sending.");
};

function toSql(entity: EntityDocument, c: Condition, params: (string | number)[], path: string): string {
  const col = (): string => {
    const f = entity.fields.find((x) => x.id === c.field);
    if (!f) fail(400, `${path}/field`, "invalid-value", `"${String(c.field)}" is not a field of ${entity.id}.`, "Use a field id of the entity.");
    params.push(`$.${c.field}`);
    return "json_extract(vals, ?)";
  };
  const nested = (key: "conditions" | "condition"): Condition[] => {
    const list = key === "condition" ? [c.condition] : c.conditions;
    if (!Array.isArray(list) || list.length === 0 || list.some((x) => typeof x !== "object" || x === null))
      fail(400, `${path}/${key}`, "invalid-value", `"${c.op}" needs ${key}.`, "See the Condition shape in @yadad/core.");
    return list as Condition[];
  };
  const op = c.op;
  if (op in COMPARE) {
    const column = col();
    const value = scalar(c.value, `${path}/value`);
    params.push(value);
    // neq uses IS NOT so a record with an empty value matches "not Done", as the memory adapter does.
    return `${column} ${COMPARE[op]} ?`;
  }
  switch (op) {
    case "in": {
      const column = col();
      const list = Array.isArray(c.values) ? c.values : [];
      if (list.length === 0) fail(400, `${path}/values`, "invalid-value", `"in" needs a non-empty values list.`, "Send values: [...].");
      for (const [i, v] of list.entries()) params.push(scalar(v, `${path}/values/${i}`));
      return `${column} IN (${list.map(() => "?").join(", ")})`;
    }
    case "empty": return `${col()} IS NULL`;
    case "notEmpty": return `${col()} IS NOT NULL`;
    case "and":
    case "or":
      return "(" + nested("conditions").map((x, i) => toSql(entity, x, params, `${path}/conditions/${i}`)).join(op === "and" ? " AND " : " OR ") + ")";
    case "not": return `NOT (${toSql(entity, nested("condition")[0]!, params, `${path}/condition`)})`;
    default:
      return fail(400, `${path}/op`, "invalid-value", `This server does not implement the filter operator "${String(op)}".`, "Use eq, neq, gt, gte, lt, lte, in, empty, notEmpty, and, or or not.");
  }
}

// ---- The records API.
export function createRecordsApp(db: DatabaseSync, entities: Map<string, EntityDocument>): Server {
  const getRow = (entity: string, id: string): Row | undefined =>
    /^\d+$/.test(id) ? (db.prepare("SELECT * FROM records WHERE entity = ? AND rid = ?").get(entity, Number(id)) as Row | undefined) : undefined;

  /** Required fields, unknown fields and field rules come from the engine's validateRecord; references are checked here. */
  function validate(entity: EntityDocument, values: Values, prefix: string): void {
    const errors: Err[] = validateRecord(entity, values, { mode: "write" }).map((e) => ({ path: prefix + e.path, code: e.code, message: e.message, hint: e.hint ?? "" }));
    for (const f of entity.fields) {
      const v = values[f.id];
      if (f.type === "reference" && typeof v === "string" && v !== "" && !getRow(f.entity, v)) {
        errors.push({ path: `${prefix}/${f.id}`, code: "invalid-value", message: `${f.label} points at a ${f.entity} that does not exist.`, hint: "Pick an existing one." });
      }
    }
    if (errors.length > 0) throw new HttpError(400, errors);
  }

  const conflict = (row: Row | undefined, what: string): never => {
    throw new HttpError(409, [{ path: "/baseVersion", code: "conflict", message: `This ${what} was changed since you loaded it.`, hint: "Reload it and try again." }], { current: row ? toRecord(row) : null });
  };

  function list(entity: EntityDocument, q: URLSearchParams) {
    const int = (name: string, dflt: number, max: number): number => {
      const raw = q.get(name);
      if (raw === null) return dflt;
      const n = Number(raw);
      if (!/^\d+$/.test(raw) || n > max) fail(400, `/${name}`, "invalid-value", `${name} must be a whole number from 0 to ${max}.`, `Send ${name}=${dflt}.`);
      return n;
    };
    if (q.has("cursor")) fail(400, "/cursor", "invalid-value", "This server pages with offset, not cursor.", "Send offset and limit.");
    const offset = int("offset", 0, Number.MAX_SAFE_INTEGER);
    const limit = int("limit", 50, 500);
    const json = (name: string): unknown => {
      try { return q.has(name) ? JSON.parse(q.get(name)!) : undefined; } catch { return fail(400, `/${name}`, "type", `${name} is not valid JSON.`, `Send ${name} as URL-encoded JSON.`); }
    };
    const params: (string | number)[] = [entity.id];
    let where = "entity = ?";
    const filter = json("filter") as Condition | undefined;
    if (filter !== undefined) where += " AND " + toSql(entity, filter, params, "/filter");
    const sort = json("sort") ?? [];
    if (!Array.isArray(sort)) fail(400, "/sort", "type", "sort must be an array.", "Send [{ field, dir }].");
    const orderParams: string[] = [];
    const order = (sort as { field?: string; dir?: string }[]).map((s, i) => {
      if (!entity.fields.some((f) => f.id === s.field) || (s.dir !== "asc" && s.dir !== "desc"))
        fail(400, `/sort/${i}`, "invalid-value", "A sort key needs a field of the entity and dir asc or desc.", 'Send { "field": "due", "dir": "asc" }.');
      orderParams.push(`$.${s.field}`, `$.${s.field}`);
      // empty values last in both directions, then the value itself
      return `json_extract(vals, ?) IS NULL, json_extract(vals, ?) ${s.dir === "desc" ? "DESC" : "ASC"}`;
    });
    order.push("rid ASC"); // a stable order
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM records WHERE ${where}`).get(...params) as { n: number }).n;
    const rows = db.prepare(`SELECT * FROM records WHERE ${where} ORDER BY ${order.join(", ")} LIMIT ? OFFSET ?`).all(...params, ...orderParams, limit, offset) as Row[];
    return { items: rows.map(toRecord), total };
  }

  function handle(method: string, url: URL, body: Record<string, unknown>): { status: number; body?: unknown } {
    const [api, records, entityId, id, ...rest] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const entity = entities.get(entityId ?? "");
    if (api !== "api" || records !== "records" || !entity || rest.length > 0)
      return fail(404, "", "not-found", "No such entity or endpoint.", "Use /api/records/{entity}[/{id}].");
    const revision = typeof body["entityRevision"] === "number" ? body["entityRevision"] : entity.revision;
    const values = (): Values => {
      const v = body["values"];
      if (typeof v !== "object" || v === null || Array.isArray(v)) fail(400, "/values", "type", "values must be an object.", "Send { values: { ... } }.");
      return Object.fromEntries(Object.entries(v as Values).filter(([, x]) => x !== null)); // null means empty: leave it out
    };

    if (id === undefined) {
      if (method === "GET") return { status: 200, body: list(entity, url.searchParams) };
      if (method === "POST") {
        const v = values();
        validate(entity, v, "/values");
        const r = db.prepare("INSERT INTO records (entity, version, revision, vals) VALUES (?, 1, ?, ?) RETURNING *").get(entity.id, revision, JSON.stringify(v)) as Row;
        return { status: 201, body: toRecord(r) };
      }
      return fail(405, "", "invalid-value", `${method} is not supported here.`, "Use GET or POST.");
    }

    const row = getRow(entity.id, id);
    if (method === "GET") return row ? { status: 200, body: toRecord(row) } : fail(404, "", "not-found", `No such ${entity.id}.`, "Reload the list.");
    if (method === "PATCH") {
      if (!row) return fail(404, "", "not-found", `No such ${entity.id}.`, "Reload the list.");
      const base = body["baseVersion"];
      if (typeof base !== "string") return fail(400, "/baseVersion", "required", "baseVersion is required on an update.", "Send the version you loaded.");
      if (base !== String(row.version)) return conflict(row, entity.id); // stale wins over invalid values
      const patch = body["values"] as Values;
      if (typeof patch === "object" && patch !== null && Object.keys(patch).length === 0) return { status: 200, body: toRecord(row) };
      const merged: Values = { ...(JSON.parse(row.vals) as Values), ...patch };
      for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
      values(); // shape check
      validate(entity, merged, "/values");
      const r = db.prepare("UPDATE records SET vals = ?, revision = ?, version = version + 1 WHERE rid = ? RETURNING *").get(JSON.stringify(merged), revision, row.rid) as Row;
      return { status: 200, body: toRecord(r) };
    }
    if (method === "DELETE") {
      if (!row) return fail(404, "", "not-found", `No such ${entity.id}.`, "Reload the list.");
      const base = url.searchParams.get("baseVersion");
      if (base !== null && base !== String(row.version)) return conflict(row, entity.id);
      db.prepare("DELETE FROM records WHERE rid = ?").run(row.rid);
      return { status: 204 };
    }
    return fail(405, "", "invalid-value", `${method} is not supported here.`, "Use GET, PATCH or DELETE.");
  }

  const send = (res: ServerResponse, status: number, body?: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(status === 204 || body === undefined ? undefined : JSON.stringify(body));
  };
  const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    let text = "";
    for await (const chunk of req) {
      text += chunk;
      if (text.length > 1_000_000) fail(400, "", "invalid-value", "The request body is too large.", "Send less.");
    }
    if (text === "") return {};
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed;
    } catch { /* falls through to the error below */ }
    return fail(400, "", "type", "The body must be a JSON object.", "Send application/json.");
  };

  return createServer(async (req, res) => {
    try {
      const out = handle(req.method ?? "GET", new URL(req.url ?? "/", "http://localhost"), await readBody(req));
      send(res, out.status, out.body);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, e.body);
      console.error(e);
      send(res, 500, { errors: [{ path: "", code: "invalid-value", message: "Something went wrong on the server.", hint: "Try again." }] });
    }
  });
}

// Run directly (`node server/index.ts`): PORT and STARTER_DB override 8787 and data/starter.db.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL("..", import.meta.url).pathname;
  const port = Number(process.env["PORT"] ?? 8787);
  const app = createRecordsApp(openDatabase(process.env["STARTER_DB"] ?? `${root}data/starter.db`), loadEntities(`${root}documents`));
  app.listen(port, "127.0.0.1", () => console.log(`records server on http://127.0.0.1:${port}/api/records`));
}
