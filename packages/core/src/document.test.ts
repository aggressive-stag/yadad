import { describe, expect, test } from "vitest";
import { defaultTitleField } from "./document.js";
import type { EntityDocument } from "./document.js";

function entityWith(fields: EntityDocument["fields"]): EntityDocument {
  return { kind: "entity", specVersion: 0, id: "e", revision: 1, fields };
}

describe("defaultTitleField", () => {
  test("is the first text field, in declaration order", () => {
    expect(defaultTitleField(entityWith([
      { id: "a", type: "number", label: "A" },
      { id: "first", type: "text", label: "First" },
      { id: "second", type: "text", label: "Second" },
    ]))).toBe("first");
  });

  test("is undefined for an entity with no text field", () => {
    expect(defaultTitleField(entityWith([
      { id: "a", type: "number", label: "A" },
      { id: "b", type: "boolean", label: "B" },
    ]))).toBeUndefined();
  });

  test("is undefined for an entity with no fields at all", () => {
    expect(defaultTitleField(entityWith([]))).toBeUndefined();
  });
});
