# @yadad/renderer

React renderers that turn entity and view documents, a registry and data adapters into working pages: `FormRenderer`, `TableRenderer`, `CalendarRenderer`, `BoardRenderer` and `DashboardRenderer`. Components are looked up in the registry by exact key; the renderer never imports one.

```sh
npm install @yadad/renderer @yadad/runtime @yadad/core react
```

Peer dependency: React 19.

```tsx
import { BoardRenderer, CalendarRenderer, DashboardRenderer, documentSet, FormRenderer, TableRenderer } from "@yadad/renderer";
import type { DocumentSet } from "@yadad/renderer";

const dataSources = new Map([["default", adapter]]); // keyed by each view's `dataSource`

<FormRenderer entity={entity} view={form} registry={registry} dataSources={dataSources} onSaved={(record) => {}} />
<TableRenderer entity={entity} view={table} registry={registry} dataSources={dataSources} reloadKey={saves} />
<CalendarRenderer entity={entity} view={calendar} registry={registry} dataSources={dataSources} reloadKey={saves} />
<BoardRenderer entity={entity} view={board} registry={registry} dataSources={dataSources} reloadKey={saves} />

// documentSet sorts a flat pile of core Documents — entities, views, at most one viewer — into the maps.
const documents: DocumentSet = documentSet([entity, form, table]);
<DashboardRenderer dashboard={dashboard} documents={documents} registry={registry} dataSources={dataSources} />
```

- **Registry.** Any `Registry<ReactNode>`: the `@yadad/components` reference set, your own, or `mockRegistry` from `@yadad/testing`. A missing key is reported in the core error format, not guessed at.
- **Data.** Views name a `dataSource` key; the host maps keys to `DataAdapter`s. Views never carry URLs.
- **Tables.** Honor `sort`, `pageSize`, the fixed `filter` and `quickFilters`. Change `reloadKey` to reload rows, e.g. after a form saves.
- **Calendars.** The records of an entity on the days of a month or week, placed by `dateField`, rendered through the registry's `layout.Calendar` (an optional key; a registry without it gets an error summary). The renderer owns the visible range, the load and the announcements and hands days, entries and callbacks to the component. With `editable: true`, a move is optimistic — only the date field is sent with the record's `baseVersion` — and on any failure the entry goes back, the adapter's message shows and the range reloads. A `rowAction` opens the target table for an entry in place, with a Back control.
- **Calendar options.** `initialMode` and `initialAnchor` (a `"YYYY-MM-DD"` day) open the calendar on a given mode and on the month or week of that day; without them it opens on the view's first mode and today.
- **Boards.** Cards in columns, one column per value of the field the board is grouped by, rendered through the registry's `layout.Board` (an optional key; a registry without it gets an error summary). Grouping is the viewer's choice among the view's `groupBy` fields and is uncontrolled by default; pass `groupBy` and `onGroupByChange` to control it from the host, or `initialGroupBy` to only open the board on another grouping (a state grid's choice) without taking the switcher away — the viewer's own choice wins from then on, and an unknown id falls back to the default. Cards load once, so switching the grouping does not refetch. With `editable: true`, moving a card (drag, or the "Move to…" action) is optimistic: only the grouping field is sent with the record's `baseVersion`, and on a 400, 403 or 409 the card goes back, the adapter's message shows and the board reloads.
- **Dashboards.** Plain CSS grid from `x, y, w, h`; the grid stacks into one column below `stackBelow` pixels (default 640). A `view` widget embeds a form, table, calendar or board; `count` and `stat` widgets show a number through the registry's count component; a `series` widget shows a measure grouped by one field (table, bar chart or line chart) through the registry's optional `widgets.series` key — without it the widget renders an error summary naming the key, the way `layout.Calendar` works. The engine pages and aggregates the records (buckets, skipped, gaps, partial, limit all computed in `runtime`) and hands the component `groups` with pre-formatted `text`. Every widget that writes refreshes the whole tab: a form save, an in-place table edit, a board or calendar move, and a record action all bump the dashboards' reload, so counts, stats and series never sit stale until the page reloads. When the viewer sees exactly one tab there is no tab strip — the grid is a region named by the dashboard's title (its id when untitled); two or more visible tabs get `layout.Tabs`.
- **Dashboard options.** `initialTab` opens the dashboard on a named tab (a states preview's choice); only the first render reads it, the viewer's own click wins from then on, and an id naming no tab — or a tab this viewer may not see — falls back to the first visible one.
- **Writes.** `TableRenderer`, `BoardRenderer` and `CalendarRenderer` take an optional `onChanged`, called once after each successful user-initiated write inside them (an edit, a move, a record action) — never on a load or a reload, so a dashboard can pass a reload bump down without looping.

## Who is viewing

Every renderer takes an optional `viewer` prop, built by `resolveViewer` in `@yadad/runtime` from the set's viewer document and what your app knows about the user. The renderer then leaves out what that viewer may not use (RFC 0006): form items, table columns, dashboard tabs and widgets whose `visibleWhen` is false are not rendered; in-place editing, drag and "Move to…" are withheld when `editableWhen` is false or the record's `can.update` is `false`; a `rowAction` is withheld while its `visibleWhen` is false. A dashboard passes the viewer on to the views it embeds and to the views a row action opens.

```tsx
import { resolveViewer } from "@yadad/runtime";

const { viewer } = resolveViewer(viewerDocument, [{ fact: "role", value: user.role }]);
<BoardRenderer entity={task} view={board} registry={registry} dataSources={dataSources} viewer={viewer} />
```

Without a `viewer` prop, a renderer that is given the document set (`documents`, whose `viewer` field holds the viewer document) uses the document's defaults; a bare view that reads a viewer fact and cannot find the document shows an error summary at `/viewer`. Views that read no viewer fact need nothing. The server stays the authority: a refused write (403) still reverts the change and reloads the records, which refreshes `can`.

## Review screens

A table, calendar or board whose entity declares `actions` and whose view lists `recordActions` shows them per row — offered in the view's order, and only where `availableActions` allows it (the action's `visibleWhen` for the record and viewer, and `can.actions` not saying false). An action with a `confirm` or `input` opens a dialog the renderer builds and draws through the registry's `layout.Dialog` (an optional key; without it a view that needs one gets an error at `/layout/Dialog`). A press runs `adapter.act` with the record's last-read `baseVersion`; the row updates with the record the action returned, including its new `can`, and a removal drops the row. An action nothing may offer is not rendered at all — never greyed out.

```tsx
<TableRenderer entity={change} view={history} registry={registry} dataSources={dataSources} />
```

- **What changed.** A column with `compare` shows its text as a word diff against a neighbouring row or another text field of the record (RFC 0007). The renderer reads the one extra row the first/last cell needs (through `neighbourQuery`, or the previous page's last row for a cursor page), runs `compareCells`, and hands the text `Display` a `diff` prop — the component draws the `<del>`/`<ins>`, the renderer computes nothing into the markup.
- **Datetimes.** A `datetime` cell goes through `formatDateTime` and reaches the `Display` as `text` plus the stored `value`, for a `<time dateTime>`; the raw string is shown only when it is not an instant at all, and the validation error names it then. A from/to quick filter on a datetime field reads the viewer's clock via `instantRangeBounds`.
- **Paging without a count.** A page that answers `total` keeps the numbered pager; one that answers only `next` switches the table to cursor paging — Previous and Next, with the cursors it has visited kept so Previous works even though the server only hands out forward tokens. A change of sort, filter or page size is a new question: the cursor stack clears. There is deliberately no "Load more".

## Reference fields

A `reference` field stores another entity's record id. Pass the documents of the target entities as `entities` (a `Map` by id; a dashboard takes them from `documents.entities`). **Every reference target must be in `entities`.** A target that is missing shows raw ids in the cells (and an error state in the picker) and logs a one-time `yadad:` console warning naming the field and the entity — the screen alone cannot tell an unwired target from data. A host that passes each page a slice of its documents should run core's `validateDocuments` over **that slice**: it reports `unknown-reference` for a reference whose target entity is not in the set. The picker's options (up to 200, sorted by the display field) and the table's labels are read from the **view's own data source**: one adapter serves every entity, so a form or table whose `dataSource` is `"default"` also reads the targets from `"default"`. A table shows the label of each id on the page, the raw id while it loads, and "Unknown" when the record no longer exists. Without `entities`, the picker shows an error state.

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

The same rule covers a table's in-place edits. Pass `drafts` to `TableRenderer` (or to `DashboardRenderer`, which hands it to every embedded table) and unsaved input in an open row edit is kept under `yadad:draft:<viewId>:<recordId>` and restored when that row's edit is opened again:

```tsx
<TableRenderer entity={entity} view={table} registry={registry} dataSources={dataSources} drafts={{ store }} />;
```

- A row's draft belongs to that record, so two rows being edited never share text.
- Saving or cancelling clears the draft; a refused save (validation, a conflict) keeps it — the text is there to fix and retry.
- Discarding starts the edit from the saved record again and clears the stored draft.
