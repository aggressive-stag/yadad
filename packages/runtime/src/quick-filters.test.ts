import type { EntityDocument } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { initialQuickFilters, quickRangeKey } from "./quick-filters.js";

const entity: EntityDocument = {
  kind: "entity", specVersion: 9, id: "t", revision: 1,
  fields: [
    { id: "s", type: "select", label: "S", options: { source: "static", values: ["a", "b"] } },
    { id: "t", type: "text", label: "T" },
    { id: "b", type: "boolean", label: "B" },
    { id: "g", type: "tags", label: "G" },
    { id: "n", type: "number", label: "N" },
    { id: "d", type: "date", label: "D" },
    { id: "w", type: "datetime", label: "W" },
  ],
};

describe("initialQuickFilters", () => {
  test("is empty without defaults", () => {
    expect(initialQuickFilters({ quickFilters: [{ field: "s" }] }, entity, "UTC")).toEqual({});
    expect(initialQuickFilters({}, entity, "UTC")).toEqual({});
  });

  test("seeds each kind in its control's form", () => {
    const state = initialQuickFilters({
      quickFilters: [
        { field: "s", default: "a" }, { field: "t", default: "x" }, { field: "b", default: false },
        { field: "g", default: ["p", "q"] }, { field: "n", default: { from: 1 } },
        { field: "d", default: { from: "2026-01-01", to: "2026-02-01" } },
        { field: "w", default: { from: "2026-10-17T09:30:00.000Z" } },
      ],
    }, entity, "UTC");
    expect(state).toEqual({
      s: "a", t: "x", b: "No", g: ["p", "q"],
      [quickRangeKey("from", "n")]: 1,
      [quickRangeKey("from", "d")]: "2026-01-01", [quickRangeKey("to", "d")]: "2026-02-01",
      [quickRangeKey("from", "w")]: "2026-10-17T09:30",
    });
  });

  test("shows a datetime bound in the viewer's zone", () => {
    const state = initialQuickFilters({ quickFilters: [{ field: "w", default: { to: "2026-10-17T09:30:00.000Z" } }] }, entity, "Asia/Tokyo");
    expect(state[quickRangeKey("to", "w")]).toBe("2026-10-17T18:30");
  });
});
