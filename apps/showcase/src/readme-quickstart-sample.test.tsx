// Card 47j: this file IS the repo README's quickstart sample — keep the two in
// step. It exists so the README sample type-checks against the current packages
// (pnpm typecheck covers it) and actually renders. README liberties: the
// registry is `mockRegistry` from "@yadad/testing", which the sample itself
// offers as the stand-in for `baseRegistry` from "@yadad/components" (that
// package lives in the components repo), and the styles import is dropped.
import type { EntityDocument, FormView, TableView } from "@yadad/core";
import { FormRenderer, TableRenderer } from "@yadad/renderer";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry as registry } from "@yadad/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { useState } from "react";
import { expect, test } from "vitest";

// The sample, verbatim.
const entity: EntityDocument = {
  kind: "entity", specVersion: 9, id: "workout_set", revision: 1,
  fields: [
    { id: "day", type: "date", label: "Day", required: true },
    { id: "exercise", type: "select", label: "Exercise", options: { source: "static", values: ["Squat", "Bench press"] } },
    { id: "reps", type: "number", label: "Reps", min: 1, step: 1 },
  ],
};

const form: FormView = {
  kind: "form", specVersion: 9, id: "log_set", entity: "workout_set", revision: 1, dataSource: "default",
  sections: [{ id: "set", title: "Log a set", items: [{ field: "day" }, { field: "exercise" }, { field: "reps" }] }],
};

const table: TableView = {
  kind: "table", specVersion: 9, id: "recent_sets", entity: "workout_set", revision: 1, dataSource: "default",
  columns: [{ field: "day" }, { field: "exercise" }, { field: "reps" }],
  filter: { op: "gte", field: "day", value: { daysFromToday: -7 } },
  quickFilters: [{ field: "exercise" }],
};

const dataSources = new Map([["default", createMemoryAdapter()]]);

export function App() {
  const [saved, setSaved] = useState(0);
  return (
    <>
      <FormRenderer entity={entity} view={form} registry={registry} dataSources={dataSources} onSaved={() => setSaved((n) => n + 1)} />
      <TableRenderer entity={entity} view={table} registry={registry} dataSources={dataSources} reloadKey={saved} />
    </>
  );
}

test("the README quickstart sample renders", () => {
  const markup = renderToStaticMarkup(<App />);
  // The form's section title renders, and no missing-key error summary appears.
  expect(markup).toContain("Log a set");
  expect(markup).not.toContain("Missing");
});
