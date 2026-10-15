# @yadad/renderer

React renderers that turn entity and view documents, a registry and data adapters into working pages: `FormRenderer`, `TableRenderer` and `DashboardRenderer`. Components are looked up in the registry by exact key; the renderer never imports one.

```sh
npm install @yadad/renderer @yadad/runtime @yadad/core react
```

Peer dependency: React 19.

```tsx
import { DashboardRenderer, FormRenderer, TableRenderer } from "@yadad/renderer";
import type { DocumentSet } from "@yadad/renderer";

const dataSources = new Map([["default", adapter]]); // keyed by each view's `dataSource`

<FormRenderer entity={entity} view={form} registry={registry} dataSources={dataSources} onSaved={(record) => {}} />
<TableRenderer entity={entity} view={table} registry={registry} dataSources={dataSources} reloadKey={saves} />

const documents: DocumentSet = { entities: new Map([[entity.id, entity]]), views: new Map([[form.id, form], [table.id, table]]) };
<DashboardRenderer dashboard={dashboard} documents={documents} registry={registry} dataSources={dataSources} />
```

- **Registry.** Any `Registry<ReactNode>`: the `@yadad/components` reference set, your own, or `mockRegistry` from `@yadad/testing`. A missing key is reported in the core error format, not guessed at.
- **Data.** Views name a `dataSource` key; the host maps keys to `DataAdapter`s. Views never carry URLs.
- **Tables.** Honor `sort`, `pageSize`, the fixed `filter` and `quickFilters`. Change `reloadKey` to reload rows, e.g. after a form saves.
- **Dashboards.** Plain CSS grid from `x, y, w, h`; the grid stacks into one column below `stackBelow` pixels (default 640).

## Reference fields

A `reference` field stores another entity's record id. Pass the documents of the target entities as `entities` (a `Map` by id; a dashboard takes them from `documents.entities`). The picker's options (up to 200, sorted by the display field) and the table's labels are read from the **view's own data source**: one adapter serves every entity, so a form or table whose `dataSource` is `"default"` also reads the targets from `"default"`. A table shows the label of each id on the page, the raw id while it loads, and "Unknown" when the record no longer exists. Without `entities`, the picker shows an error state.

## Drafts

Drafts are opt-in. Pass `drafts` to `FormRenderer` (or to `DashboardRenderer`, which hands it to every embedded form) and unsaved input is saved after a pause (`debounceMs`, default 400) and restored the next time the form mounts:

```tsx
import { createDraftStore } from "@yadad/runtime";

const store = createDraftStore(window.localStorage);
<FormRenderer entity={entity} view={form} registry={registry} dataSources={dataSources} drafts={{ store, debounceMs: 400 }} />;
```

- Drafts are kept per form view id, for create forms (stored under `yadad:draft:<viewId>:new`). Only input typed in the current session is written back, and what is stored is what the form would save (hidden `clearWhenHidden` values are left out).
- A draft is cleared when the form is saved, when the user discards the restored values, or when every value has been emptied.
- If the documents changed since the draft was taken, values for fields the entity no longer has are dropped, and the form shows a "Restored unsaved changes" notice saying the form changed (entity revision differs) and/or that some values were left out. The restored values are never saved automatically.
