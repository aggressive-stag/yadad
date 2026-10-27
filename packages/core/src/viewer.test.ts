import { describe, expect, test } from "vitest";
import { conditionFields, conditionViewerFacts } from "./condition.js";
import type { Condition } from "./condition.js";
import { VIEWER_FACTS_MAX, VIEWER_FACT_VALUES_MAX, describeContract } from "./contract.js";
import type { DataRecord } from "./data-adapter.js";
import { SPEC_VERSION, VIEWER_FACT_TYPES } from "./document.js";
import { migrate } from "./migrate.js";
import { validateDocument, validateDocuments } from "./validate.js";

const viewer = {
  kind: "viewer",
  specVersion: 5,
  id: "viewer",
  revision: 1,
  facts: [
    { id: "role", label: "Role", type: "select", options: { source: "static", values: ["viewer", "owner"] }, default: "viewer" },
    { id: "beta", label: "Beta", type: "boolean", default: false },
  ],
};

describe("viewer conditions", () => {
  const mixed: Condition = {
    op: "and",
    conditions: [
      { op: "notEmpty", field: "approver" },
      { op: "not", condition: { op: "viewerIn", fact: "role", values: ["owner"] } },
      { op: "viewerIn", fact: "beta", values: [true] },
    ],
  };

  test("conditionFields skips viewerIn leaves and conditionViewerFacts lists their facts", () => {
    expect(conditionFields(mixed)).toEqual(["approver"]);
    expect(conditionViewerFacts(mixed)).toEqual(["role", "beta"]);
    expect(conditionViewerFacts({ op: "eq", field: "a", value: 1 })).toEqual([]);
  });

  test("the depth limit applies to viewer conditions", () => {
    let c: Record<string, unknown> = { op: "viewerIn", fact: "role", values: ["owner"] };
    for (let i = 0; i < describeContract().conditions.maxDepth + 1; i++) c = { op: "not", condition: c };
    const table = { kind: "table", specVersion: 5, id: "t", entity: "e", revision: 1, dataSource: "d", columns: [{ field: "a", visibleWhen: c }] };
    const result = validateDocument(table);
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual(["invalid-value"]);
  });
});

describe("viewer document", () => {
  test("a minimal viewer validates and the limits come from the contract", () => {
    expect(validateDocument(viewer).ok).toBe(true);
    const description = describeContract().viewer;
    expect(description).toEqual({ factTypes: [...VIEWER_FACT_TYPES], factsMax: VIEWER_FACTS_MAX, factValuesMax: VIEWER_FACT_VALUES_MAX, factValuesMin: 2, documentsMax: 1 });
    expect(VIEWER_FACTS_MAX).toBe(8);
    expect(VIEWER_FACT_VALUES_MAX).toBe(8);
  });

  test("exactly eight facts and eight values are accepted", () => {
    const facts = Array.from({ length: 8 }, (_, i) => ({ id: `f${i}`, label: "F", type: "select", options: { source: "static", values: ["a", "b", "c", "d", "e", "f", "g", "h"] }, default: "a" }));
    expect(validateDocument({ ...viewer, facts }).ok).toBe(true);
  });

  test("describeContract lists the viewer kind, viewerIn and a place for every placement row", () => {
    const contract = describeContract();
    expect(contract.documentKinds.map((k) => k.kind)).toContain("viewer");
    expect(contract.conditions.ops.map((o) => o.op)).toContain("viewerIn");
    expect(contract.conditionPlaces.map((p) => `${p.path}:${p.accepts}`)).toEqual([
      "/actions/*/visibleWhen:record+viewer",
      "/sections/*/items/*/visibleWhen:record+viewer",
      "/sections/*/items/*/requiredWhen:record+viewer",
      "/columns/*/visibleWhen:viewer",
      "/columns/*/editableWhen:viewer",
      "/editableWhen:viewer",
      "/rowAction/visibleWhen:viewer",
      "/tabs/*/visibleWhen:viewer",
      "/tabs/*/items/*/visibleWhen:viewer",
      "/filter:record",
      "/filters/*/condition:record", // RFC 0009 item 5
      "/tabs/*/items/*/filter:record",
    ]);
  });

  test("a viewer leaf is accepted in a viewer place and the declared fact must exist in the set", () => {
    const form = { kind: "form", specVersion: 5, id: "f", entity: "e", revision: 1, dataSource: "d", sections: [{ id: "s", items: [{ field: "a", visibleWhen: { op: "viewerIn", fact: "role", values: ["owner"] } }] }] };
    const entity = { kind: "entity", specVersion: 5, id: "e", revision: 1, fields: [{ id: "a", type: "text", label: "A" }] };
    expect(validateDocuments([entity, viewer, form]).ok).toBe(true);
    const without = validateDocuments([entity, form]);
    expect(without.ok ? [] : without.errors.map((e) => [e.path, e.code, e.message])).toEqual([
      ["/sections/0/items/0/visibleWhen/fact", "unknown-reference", "No viewer document declares viewer facts."],
    ]);
  });
});

describe("version 5", () => {
  test("migrate stamps a version 4 document and changes nothing else", () => {
    const v4 = { kind: "table", specVersion: 4, id: "t", entity: "e", revision: 1, dataSource: "d", columns: [{ field: "a" }] };
    expect(migrate(v4)).toEqual({ ...v4, specVersion: 10 });
    expect(SPEC_VERSION).toBe(10);
  });

  test("a version 4 document with none of the new keys still validates unchanged", () => {
    expect(validateDocument({ kind: "table", specVersion: 4, id: "t", entity: "e", revision: 1, dataSource: "d", columns: [{ field: "a" }] }).ok).toBe(true);
  });
});

describe("DataRecord.can", () => {
  test("is optional and carries update and delete hints", () => {
    const plain: DataRecord = { id: "1", entityId: "e", entityRevision: 1, version: "1", values: {} };
    const locked: DataRecord = { ...plain, can: { update: false } };
    expect(plain.can).toBeUndefined();
    expect(locked.can?.update).toBe(false);
  });
});
