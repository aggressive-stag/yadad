// One complete, valid document set per kind, printed by
// `ydcli describe --example <kind>`. They live here, in one place, and
// testing/src/describe-registry-output.test.ts validates every one with
// validateDocuments, so they cannot rot. Each set holds the documents the
// kind needs (its entity, and for a dashboard the view it embeds).

export const EXAMPLE_KINDS = ["entity", "form", "table", "calendar", "board", "dashboard", "viewer", "conditions"] as const;
export type ExampleKind = (typeof EXAMPLE_KINDS)[number];

export function examples(specVersion: number): Record<ExampleKind, readonly object[]> {
  const entity = {
    kind: "entity",
    specVersion,
    id: "workout_set",
    revision: 1,
    fields: [
      { id: "day", type: "date", label: "Day", required: true },
      { id: "exercise", type: "select", label: "Exercise", options: { source: "static", values: ["Squat", "Bench press"] } },
      { id: "reps", type: "number", label: "Reps", min: 1, step: 1 },
      { id: "felt", type: "select", label: "How did it feel?", options: { source: "static", values: ["Easy", "Hard"] } },
      { id: "why", type: "text", label: "What made it hard?" },
    ],
  };
  const base = { specVersion, revision: 1, entity: "workout_set", dataSource: "default" };
  const form = {
    kind: "form",
    ...base,
    id: "log_set",
    sections: [{ id: "set", title: "Log a set", items: [{ field: "day" }, { field: "exercise" }, { field: "reps" }] }],
  };
  const table = {
    kind: "table",
    ...base,
    id: "recent_sets",
    title: "Recent sets",
    columns: [{ field: "day" }, { field: "exercise" }, { field: "reps", editable: true }],
    sort: [{ field: "day", dir: "desc" }],
    filter: { op: "gte", field: "day", value: { daysFromToday: -7 } },
    quickFilters: [{ field: "exercise" }],
    pageSize: 25,
  };
  const calendar = { kind: "calendar", ...base, id: "sets_calendar", title: "Sets by day", dateField: "day", titleField: "exercise" };
  const board = { kind: "board", ...base, id: "sets_board", title: "Sets by exercise", groupBy: [{ field: "felt" }], titleField: "exercise" };
  const dashboard = {
    kind: "dashboard",
    specVersion,
    id: "training",
    revision: 1,
    title: "Training",
    tabs: [
      {
        id: "overview",
        title: "Overview",
        items: [
          // x and y count grid columns and rows from 0; w and h are the columns and rows spanned.
          { id: "log", x: 0, y: 0, w: 8, h: 6, widget: "view", view: "recent_sets" },
          { id: "hard", x: 8, y: 0, w: 4, h: 2, widget: "count", label: "Hard sets", view: "recent_sets", filter: { op: "eq", field: "felt", value: "Hard" } },
        ],
      },
    ],
  };
  const viewer = {
    kind: "viewer",
    specVersion,
    id: "viewer",
    revision: 1,
    facts: [{ id: "role", label: "Role", type: "select", options: { source: "static", values: ["viewer", "editor"] }, default: "viewer" }],
  };
  const tableForEditors = {
    kind: "table",
    ...base,
    id: "sets_for_editors",
    columns: [{ field: "day" }, { field: "exercise" }, { field: "reps", visibleWhen: { op: "viewerIn", fact: "role", values: ["editor"] } }],
  };
  const conditionalForm = {
    kind: "form",
    ...base,
    id: "log_set_with_rules",
    sections: [
      {
        id: "set",
        title: "Log a set",
        items: [
          { field: "day" },
          { field: "felt" },
          // Shown, and required, only while felt is Hard; cleared again if it stops being Hard.
          { field: "why", visibleWhen: { op: "eq", field: "felt", value: "Hard" }, requiredWhen: { op: "eq", field: "felt", value: "Hard" }, clearWhenHidden: true },
        ],
      },
    ],
  };
  return {
    entity: [entity],
    form: [entity, form],
    table: [entity, table],
    calendar: [entity, calendar],
    board: [entity, board],
    dashboard: [entity, table, dashboard],
    viewer: [viewer, entity, tableForEditors],
    conditions: [entity, conditionalForm],
  };
}
