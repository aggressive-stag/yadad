// The renderer package's own tests import its modules by relative path; a test here is the one that
// imports from the package root, the way a consumer does — that is how a missing root export shows up.
import type { Document, EntityDocument, TableView, ViewerDocument } from "@yadad/core";
import { documentSet } from "@yadad/renderer";
import type { DocumentSet } from "@yadad/renderer";
import { describe, expect, test } from "vitest";

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 0,
  id: "workout_set",
  revision: 1,
  fields: [{ id: "day", type: "date", label: "Day", required: true }],
};

const table: TableView = {
  kind: "table",
  specVersion: 0,
  id: "sets",
  revision: 1,
  title: "Sets",
  entity: "workout_set",
  dataSource: "default",
  columns: [{ field: "day" }],
};

const viewer: ViewerDocument = {
  kind: "viewer",
  specVersion: 0,
  id: "viewer",
  revision: 1,
  facts: [{ id: "role", label: "Role", type: "select", options: { source: "static", values: ["viewer", "owner"] }, default: "viewer" }],
};

describe("documentSet (imported from the package root)", () => {
  test("sorts each document kind into its map", () => {
    const set: DocumentSet = documentSet([entity, table, viewer]);
    expect([...set.entities.keys()]).toEqual(["workout_set"]);
    expect(set.entities.get("workout_set")).toBe(entity);
    expect([...set.views.keys()]).toEqual(["sets"]);
    expect(set.views.get("sets")).toBe(table);
    expect(set.viewer).toBe(viewer);
  });

  test("an empty pile and a viewer-less pile both build", () => {
    const empty: DocumentSet = documentSet([]);
    expect(empty.entities.size).toBe(0);
    expect(empty.views.size).toBe(0);
    expect("viewer" in empty).toBe(false);

    const noViewer: DocumentSet = documentSet([entity, table]);
    expect("viewer" in noViewer).toBe(false);
  });

  test("the last viewer document wins", () => {
    const second: ViewerDocument = { ...viewer, id: "viewer2" };
    const set = documentSet([viewer, second]);
    expect(set.viewer).toBe(second);
  });

  test("a hand-built pile of Documents reaches DashboardRenderer's prop type", () => {
    const docs: readonly Document[] = [entity, table, viewer];
    const set = documentSet(docs);
    // The point of the builder: the result IS the prop type, no redeclaration.
    const asProp: DocumentSet = set;
    expect(asProp.entities.get("workout_set")?.kind).toBe("entity");
  });
});
