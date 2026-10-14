# @yadad/editor

Visual editors for yadad documents. Every change is a JSON Patch against an entity or view document, with undo and redo from the patch log; saving hands back the edited document with its `revision` bumped. The editor writes documents, never records.

```sh
npm install @yadad/editor @yadad/core @yadad/runtime react
```

Peer dependency: React 19.

## Components

Each takes the document, an injected `Registry<ReactNode>`, and `onSave` / `onCancel`:

- `EntityFieldsEditor`: add a field, change its label, options or required flag, or remove one no view uses. Ids and types of existing fields are fixed because saved records depend on them. Takes `views` so it can refuse removing a field still in use.
- `FormViewEditor`: place entity fields in sections, reorder, and add, rename or remove sections. Conditions on fields are kept and shown.
- `TableViewEditor`: choose and order columns, which are editable in place, the title, sorting, page size, and quick filters.
- `DashboardLayoutEditor`: tabs and a 12-column grid of form, table and count widgets. Drag and resize are hand-written over CSS grid with pointer and full keyboard support. Optional `views`, `entities` and `describeView` supply the widget palette and readable names.

```tsx
import { FormViewEditor } from "@yadad/editor";

<FormViewEditor view={form} entity={entity} registry={registry} onSave={(next) => save(next)} onCancel={close} />;
```

Property panels are built from an exhaustive per-field-type map, so a new field type cannot ship without an editor.

## Helpers

- `blankEntity(id)`, `blankForm(entity, id, dataSource)`, `blankTable(entity, id, dataSource)` (null while the entity has no fields) and `blankDashboard(id, title?)` create starting documents.
- `startSession`, `edit`, `undo`, `redo`, `isDirty` and `finish` drive an `EditSession` directly if you build your own UI.
- `idFromTitle(title, used, fallback)` turns a title into a valid id that is unique among `used`.

See the [repo README](../../README.md) and [ARCHITECTURE.md](../../ARCHITECTURE.md).
