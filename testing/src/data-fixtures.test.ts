import { readdirSync, readFileSync } from "node:fs";
import type { DataRecord, Page, RecordPermissions } from "@yadad/core";
import { expect, test } from "vitest";

const dataDir = new URL("../../fixtures/data/", import.meta.url);
const read = (file: string): unknown => JSON.parse(readFileSync(new URL(file, dataDir), "utf8"));

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function isPermissions(v: unknown): v is RecordPermissions {
  if (!isObject(v)) return false;
  const { update, delete: del, actions, ...rest } = v;
  if (Object.keys(rest).length > 0) return false;
  if (update !== undefined && typeof update !== "boolean") return false;
  if (del !== undefined && typeof del !== "boolean") return false;
  return actions === undefined || (isObject(actions) && Object.values(actions).every((a) => typeof a === "boolean"));
}

function isDataRecord(v: unknown): v is DataRecord {
  return (
    isObject(v) &&
    typeof v["id"] === "string" &&
    typeof v["entityId"] === "string" &&
    typeof v["entityRevision"] === "number" &&
    typeof v["version"] === "string" &&
    isObject(v["values"]) &&
    (v["can"] === undefined || isPermissions(v["can"]))
  );
}

function isPage(v: unknown): v is Page<DataRecord> {
  return (
    isObject(v) &&
    Array.isArray(v["items"]) &&
    v["items"].every(isDataRecord) &&
    (v["total"] === undefined || typeof v["total"] === "number") &&
    (v["next"] === undefined || v["next"] === null || typeof v["next"] === "string")
  );
}

test("fixtures/data holds exactly the expected files", () => {
  expect(readdirSync(dataDir).filter((f) => f.endsWith(".json")).sort()).toEqual([
    "action-conflict-409.json",
    "page-cursor-last.json",
    "page-cursor-no-total.json",
    "record-can-actions.json",
    "record-time-tags.json",
  ]);
});

test("a record carrying a time value and a tags list", () => {
  const record = read("record-time-tags.json");
  expect(isDataRecord(record)).toBe(true);
  if (!isDataRecord(record)) return;
  expect(record.values["due_time"]).toBe("18:30");
  expect(record.values["labels"]).toEqual(["yard", "weekend"]);
});

test("a page with a cursor and no total", () => {
  const page = read("page-cursor-no-total.json");
  expect(isPage(page)).toBe(true);
  if (!isPage(page)) return;
  expect(page.total).toBeUndefined();
  expect(typeof page.next).toBe("string");
  expect(page.items).toHaveLength(2);
});

test("the last cursor page has next null and still no total", () => {
  const page = read("page-cursor-last.json");
  expect(isPage(page)).toBe(true);
  if (!isPage(page)) return;
  expect(page.total).toBeUndefined();
  expect(page.next).toBeNull();
});

test("a record carries can.actions, where only false restricts", () => {
  const record = read("record-can-actions.json");
  expect(isDataRecord(record)).toBe(true);
  if (!isDataRecord(record)) return;
  expect(record.can?.actions).toEqual({ apply: true, reject: false });
});

test("an action 409 body names the problem and carries the current record", () => {
  const body = read("action-conflict-409.json");
  expect(isObject(body)).toBe(true);
  if (!isObject(body)) return;
  expect(Array.isArray(body["errors"]) && body["errors"].every((e) => isObject(e) && e["code"] === "conflict" && typeof e["message"] === "string" && typeof e["hint"] === "string")).toBe(true);
  expect(isDataRecord(body["current"])).toBe(true);
});
