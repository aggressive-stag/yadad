import { describe, expect, test } from "vitest";
import { SPEC_VERSION } from "./document.js";
import { migrate } from "./migrate.js";
import { validateDocument } from "./validate.js";

const v0 = { kind: "entity", specVersion: 0, id: "e", revision: 1, fields: [{ id: "a", type: "text", label: "A" }] };

describe("migrate", () => {
  test("stamps a version 0 document with the current version and keeps everything else", () => {
    const result = migrate(v0);
    expect(result).toEqual({ ...v0, specVersion: SPEC_VERSION });
    expect(validateDocument(result).ok).toBe(true);
  });

  test("does not mutate its input and leaves a current document alone", () => {
    const copy = structuredClone(v0);
    const once = migrate(v0);
    expect(v0).toEqual(copy);
    expect(migrate(once)).toEqual(once);
  });

  test("returns anything it cannot migrate unchanged, for the validator to report", () => {
    expect(migrate(5)).toBe(5);
    expect(migrate({ kind: "entity" })).toEqual({ kind: "entity" });
    expect(migrate({ ...v0, specVersion: "0" })).toEqual({ ...v0, specVersion: "0" });
    expect(migrate({ ...v0, specVersion: 99 })).toEqual({ ...v0, specVersion: 99 });
  });
});
