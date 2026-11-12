import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { after, before, describe, test } from "node:test";
import { createRecordsApp, loadEntities, openDatabase } from "./index.ts";

interface Rec { id: string; version: string; values: Record<string, unknown> }
interface Err { path: string; code: string }
/** What the tests read from a response body; each test uses only the part its status implies. */
type Json = Rec & { items: Rec[]; total: number; errors: Err[]; current: Rec };

const dir = mkdtempSync(`${tmpdir()}/starter-test-`);
const server = createRecordsApp(openDatabase(`${dir}/test.db`), loadEntities(new URL("../documents", import.meta.url).pathname));
let base = "";
before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/records`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, { method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
  return { status: res.status, json: (res.status === 204 ? null : await res.json()) as Json };
};
const create = async (entity: string, values: object) => (await call("POST", `/${entity}`, { values, entityRevision: 1 })).json;
const list = (qs: string) => call("GET", `/task?${qs}`).then((r) => r.json);
const filterOf = (f: object, extra = "") => list(`filter=${encodeURIComponent(JSON.stringify(f))}${extra}`);
const titles = (r: Json) => r.items.map((i: Rec) => i.values.title as string);

describe("records server", () => {
  let ada: Json;
  before(async () => {
    ada = await create("person", { name: "Ada" });
    const rows = [
      ["A", "To do", "2026-01-01"], ["B", "In progress", "2026-02-01"], ["C", "Done", "2026-03-01"],
      ["D", "Blocked", undefined], ["E", "To do", "2026-05-01"],
    ] as const;
    for (const [title, status, due] of rows) await create("task", { title, status, ...(due ? { due, notes: "n" } : { notes: "why" }) });
  });

  test("create returns 201 with id, version and values; find one reads it back", async () => {
    const r = await call("POST", "/task", { values: { title: "Xylophone", status: "To do", assignee: ada.id }, entityRevision: 1 });
    assert.equal(r.status, 201);
    assert.equal(r.json.version, "1");
    assert.equal((await call("GET", `/task/${r.json.id}`)).json.values.title, "Xylophone");
    assert.equal((await call("GET", "/task/99999")).status, 404);
    assert.equal((await call("GET", "/nothing")).status, 404);
  });

  test("operators: eq neq gt gte lt lte in empty notEmpty and or not", async () => {
    const f = (c: object) => filterOf(c, `&sort=${encodeURIComponent('[{"field":"title","dir":"asc"}]')}`).then((r) => titles(r).filter((t: string) => t.length === 1));
    assert.deepEqual(await f({ op: "eq", field: "status", value: "Done" }), ["C"]);
    assert.deepEqual(await f({ op: "neq", field: "status", value: "To do" }), ["B", "C", "D"]);
    assert.deepEqual(await f({ op: "gt", field: "due", value: "2026-02-01" }), ["C", "E"]);
    assert.deepEqual(await f({ op: "gte", field: "due", value: "2026-02-01" }), ["B", "C", "E"]);
    assert.deepEqual(await f({ op: "lt", field: "due", value: "2026-02-01" }), ["A"]);
    assert.deepEqual(await f({ op: "lte", field: "due", value: "2026-02-01" }), ["A", "B"]);
    assert.deepEqual(await f({ op: "in", field: "status", values: ["Done", "Blocked"] }), ["C", "D"]);
    assert.deepEqual(await f({ op: "empty", field: "due" }), ["D"]);
    assert.deepEqual(await f({ op: "notEmpty", field: "due" }), ["A", "B", "C", "E"]);
    assert.deepEqual(await f({ op: "and", conditions: [{ op: "eq", field: "status", value: "To do" }, { op: "gt", field: "due", value: "2026-02-01" }] }), ["E"]);
    assert.deepEqual(await f({ op: "or", conditions: [{ op: "eq", field: "status", value: "Done" }, { op: "empty", field: "due" }] }), ["C", "D"]);
    assert.deepEqual(await f({ op: "not", condition: { op: "eq", field: "status", value: "To do" } }), ["B", "C", "D"]);
  });

  test("an operator the server lacks is a 400 with a path, not a 500 and not an unfiltered list", async () => {
    const r = await call("GET", `/task?filter=${encodeURIComponent(JSON.stringify({ op: "contains", field: "title", value: "A" }))}`);
    assert.equal(r.status, 400);
    assert.equal(r.json.errors[0]?.path, "/filter/op");
    assert.equal(r.json.errors[0]?.code, "invalid-value");
    const unknown = await call("GET", `/task?filter=${encodeURIComponent(JSON.stringify({ op: "eq", field: "nope", value: 1 }))}`);
    assert.equal(unknown.status, 400);
    const injected = await call("GET", `/task?filter=${encodeURIComponent(JSON.stringify({ op: "eq", field: "status'; DROP TABLE records;--", value: 1 }))}`);
    assert.equal(injected.status, 400);
    assert.equal((await call("GET", "/task?limit=1")).status, 200); // the table is still there
  });

  test("sort puts empty values last in both directions", async () => {
    const asc = titles(await list(`sort=${encodeURIComponent('[{"field":"due","dir":"asc"}]')}&limit=5`));
    const desc = titles(await list(`sort=${encodeURIComponent('[{"field":"due","dir":"desc"}]')}&limit=5`));
    assert.equal(asc.indexOf("D") >= asc.length - 2, true);
    assert.deepEqual(asc.slice(0, 3), ["A", "B", "C"]);
    assert.deepEqual(desc.slice(0, 2), ["E", "C"]);
    assert.equal(desc.indexOf("D") >= desc.length - 2, true);
  });

  test("paging across two pages, with the real total; limit=0 counts", async () => {
    const q = `sort=${encodeURIComponent('[{"field":"title","dir":"asc"}]')}`;
    const p1 = await list(`${q}&offset=0&limit=3`);
    const p2 = await list(`${q}&offset=3&limit=3`);
    assert.equal(p1.items.length, 3);
    assert.equal(p2.items.length, 3);
    assert.equal(p1.total, p2.total);
    assert.equal(new Set([...p1.items, ...p2.items].map((i: Rec) => i.id)).size, 6);
    assert.equal((await list("limit=0")).items.length, 0);
    assert.equal((await call("GET", "/task?limit=501")).status, 400);
    assert.equal((await call("GET", "/task?offset=-1")).status, 400);
  });

  test("update patches, bumps the version, and a stale baseVersion is a 409 with current", async () => {
    const r = await create("task", { title: "Edit me", status: "To do" });
    const ok = await call("PATCH", `/task/${r.id}`, { values: { status: "Done" }, entityRevision: 1, baseVersion: r.version });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.version, "2");
    assert.equal(ok.json.values.title, "Edit me");
    const stale = await call("PATCH", `/task/${r.id}`, { values: { status: "Blocked" }, entityRevision: 1, baseVersion: r.version });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.errors[0]?.code, "conflict");
    assert.equal(stale.json.errors[0]?.path, "/baseVersion");
    assert.equal(stale.json.current.values.status, "Done");
    // stale wins over invalid
    const both = await call("PATCH", `/task/${r.id}`, { values: { status: "Nope" }, entityRevision: 1, baseVersion: r.version });
    assert.equal(both.status, 409);
    // an empty patch is a no-op, null clears
    assert.equal((await call("PATCH", `/task/${r.id}`, { values: {}, entityRevision: 1, baseVersion: "2" })).json.version, "2");
    const cleared = await call("PATCH", `/task/${r.id}`, { values: { due: null }, entityRevision: 1, baseVersion: "2" });
    assert.equal(cleared.json.values.due, undefined);
    assert.equal((await call("PATCH", `/task/${r.id}`, { values: {}, entityRevision: 1 })).status, 400);
  });

  test("delete, with and without a stale baseVersion", async () => {
    const r = await create("task", { title: "Bye", status: "To do" });
    await call("PATCH", `/task/${r.id}`, { values: { title: "Bye2" }, entityRevision: 1, baseVersion: "1" });
    assert.equal((await call("DELETE", `/task/${r.id}?baseVersion=1`)).status, 409);
    assert.equal((await call("DELETE", `/task/${r.id}?baseVersion=2`)).status, 204);
    assert.equal((await call("GET", `/task/${r.id}`)).status, 404);
    assert.equal((await call("DELETE", `/task/${r.id}`)).status, 404);
  });

  test("a create that fails validation is a 400 with a path for each problem", async () => {
    const r = await call("POST", "/task", { values: { status: "Sleeping", bogus: 1, assignee: "9999" }, entityRevision: 1 });
    assert.equal(r.status, 400);
    const paths = r.json.errors.map((e: Err) => e.path).sort();
    assert.deepEqual(paths, ["/values/assignee", "/values/bogus", "/values/status", "/values/title"]);
    assert.equal((await call("POST", "/task", { entityRevision: 1 })).status, 400);
  });

  test("ids are not reused after a delete", async () => {
    const a = await create("person", { name: "Temp" });
    await call("DELETE", `/person/${a.id}`);
    const b = await create("person", { name: "Next" });
    assert.notEqual(a.id, b.id);
  });
});
