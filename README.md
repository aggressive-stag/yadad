# yadad

Yet another drag and drop: a schema-driven React engine for data-bound apps. You describe an app as small, strictly validated JSON documents (entities that own fields, and views that show them), and a renderer turns those documents plus live records into working forms, record tables and dashboards. Documents can be stored in a database and edited visually, so changing an app needs no redeploy.

## What you get

- **Documents as the contract.** Entities, forms, tables and dashboards are plain JSON with a JSON-Schema-backed validator that reports errors by JSON Pointer, with a hint for each.
- **A headless runtime.** Form state, conditions, record validation and JSON Patch, with no React and no DOM.
- **React renderers** for forms, tables and dashboards that look every component up in a registry you inject.
- **Visual editors** for fields, form layout, table columns and dashboard grids. Every edit is a JSON Patch with undo/redo, and drag and resize work from the keyboard.
- **Data adapters** (memory, key-value, HTTP) with record versions and optimistic concurrency.
- **A theme** of CSS-variable tokens, and a test kit for component sets.

## Quick start

The packages are published to the project's GitLab npm registry. Point the `@yadad` scope at it, then install (React 19 is a peer dependency):

```sh
echo "@yadad:registry=<registry URL>" >> .npmrc
npm install @yadad/core @yadad/runtime @yadad/renderer @yadad/theme @yadad/components react react-dom
```

Describe an entity and two views, give the renderer a registry and a data adapter, and render:

```tsx
import type { EntityDocument, FormView, TableView } from "@yadad/core";
import { FormRenderer, TableRenderer } from "@yadad/renderer";
import { createMemoryAdapter } from "@yadad/runtime";
import { baseRegistry as registry } from "@yadad/components"; // or `mockRegistry` from "@yadad/testing"
import "@yadad/components/styles.css";
import { useState } from "react";

const entity: EntityDocument = {
  kind: "entity", specVersion: 1, id: "workout_set", revision: 1,
  fields: [
    { id: "day", type: "date", label: "Day", required: true },
    { id: "exercise", type: "select", label: "Exercise", options: { source: "static", values: ["Squat", "Bench press"] } },
    { id: "reps", type: "number", label: "Reps", min: 1, step: 1 },
  ],
};

const form: FormView = {
  kind: "form", specVersion: 1, id: "log_set", entity: "workout_set", revision: 1, dataSource: "default",
  sections: [{ id: "set", title: "Log a set", items: [{ field: "day" }, { field: "exercise" }, { field: "reps" }] }],
};

const table: TableView = {
  kind: "table", specVersion: 1, id: "recent_sets", entity: "workout_set", revision: 1, dataSource: "default",
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
```

Documents that come from a database or a user are untrusted JSON: run them through `validateDocument` from `@yadad/core` first. Emit the theme's CSS variables once, e.g. into a `<style>` tag, with `themeToCss(lightTheme)` from `@yadad/theme`. Swap `createMemoryAdapter()` for `createHttpAdapter({ baseUrl: "/api/records" })` to talk to a backend that speaks the [records protocol](docs/records-protocol.md).

## Packages

| Package | What it is |
| --- | --- |
| [`@yadad/core`](packages/core) | Document types, validation, migrations, and the `Registry` and `DataAdapter` contracts. No dependencies on React. |
| [`@yadad/runtime`](packages/runtime) | Headless form state, conditions, record validation, JSON Patch, drafts, and the memory, key-value and HTTP adapters. |
| [`@yadad/renderer`](packages/renderer) | React `FormRenderer`, `TableRenderer` and `DashboardRenderer`. |
| [`@yadad/editor`](packages/editor) | Visual editors that emit JSON Patch against documents. |
| [`@yadad/theme`](packages/theme) | Design tokens, light and dark themes, and the CSS-variable emitter. |
| [`@yadad/testing`](testing) | A mock registry and the contract test kit for component sets. |

`apps/showcase` renders the fixtures in `fixtures/` and lets you edit them in place; run it with `pnpm --filter @yadad/showcase dev`.

## Key concepts

- **Entity and view documents.** An entity owns fields, types and validation. Views show an entity: a `form` (sections of fields), a `table` (columns, sorting, paging, filters) or a `dashboard` (tabs of form, table and count widgets on a 12-column grid). `pnpm describe-registry` prints everything a document may contain.
- **Registry.** The engine never imports a component. You inject a `Registry`, which maps each field type, layout piece and widget to a React component by exact key. [`yadad-components`](https://github.com/aggressive-stag/yadad-components) is the reference set (`@yadad/components`); bring your own if you prefer.
- **Data adapters.** A view names a `dataSource` key, never a URL; the host maps the key to a `DataAdapter`. Records carry a `version`, and a stale write is a conflict.
- **Conditions.** A JSON AST (`eq`, `gt`, `in`, `and`, `not`, ...) drives `visibleWhen`, `requiredWhen` and filters; there are no string expressions. Date comparisons accept a relative date, `{ "daysFromToday": n }` (0 is today, -7 a week ago), resolved from the viewer's local date.
- **Quick filters.** A table's `quickFilters` lets the viewer filter by a field: exact for select and boolean, substring for text, a from/to range for number and date.
- **`specVersion` and `revision`.** `specVersion` is the engine's document format (currently 1) and is upgraded by `migrate()`. `revision` is bumped whenever a user edits a document; it is data, not code.
- **Document ids.** Document, field, section, tab and grid-item ids all match `[a-z][a-z0-9_]*`: lowercase letters, digits and underscores, starting with a letter. Use `workout_set`, not `workout-set`, `WorkoutSet` or `1st_set`. Grid-item ids only need to be unique within their tab.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): the authoritative design.
- [docs/DECISIONS.md](docs/DECISIONS.md): settled decisions and what they replaced.
- [docs/records-protocol.md](docs/records-protocol.md): the HTTP records protocol a backend implements.
- [rfcs/](rfcs): proposals for changes to the contract.

## Contributing

Clone the repo, run `pnpm install`, and read [AGENTS.md](AGENTS.md) for the workflow, the rules each package follows and the checks every change must pass. Commits follow the Angular format.
