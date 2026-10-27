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
- **Tables.** Honor `sort`, `pageSize`, the fixed `filter` and `quickFilters`, and the view's `filters` — named saved filters rendered as chips; which one is selected is the host's business, not the component's (RFC 0009 item 5). With `addForm`, offer "Add {entity}" and open that form view; a save reloads the table. Change `reloadKey` to reload rows, e.g. after a form saves.
- **Calendars.** The records of an entity on the days of a month or week, placed by `dateField`, rendered through the registry's `layout.Calendar` (an optional key; a registry without it gets an error summary). The renderer owns the visible range, the load and the announcements and hands days, entries and callbacks to the component. With `editable: true`, a move is optimistic — only the date field is sent with the record's `baseVersion` — and on any failure the entry goes back, the adapter's message shows and the range reloads. A `rowAction` opens the target table for an entry in place, with a Back control.
- **Calendar options.** `initialMode` and `initialAnchor` (a `"YYYY-MM-DD"` day) open the calendar on a given mode and on the month or week of that day; without them it opens on the view's first mode and today. With `doneField` (a boolean field), every entry gets the component's completion checkbox: the renderer patches just that field through the record's normal `update` (not `act`), gated by `can.update` and the record's `can.fields`, and announces the result. `maxEntriesPerDay` (default 3) caps the entries per day; the component gets `{ shown, hidden }` and owns the "+N more" disclosure. Entry labels name each detail field ("Assignee: Ada", not "Ada").
- **Boards.** Cards in columns, one column per value of the field the board is grouped by — for a reference grouping, `columnsFrom: "options"` builds the columns from the referenced entity's options (a value with no cards gets a column and no drop target) instead of the default `"records"`, which builds them from the records that have cards — rendered through the registry's `layout.Board` (an optional key; a registry without it gets an error summary). Grouping is the viewer's choice among the view's `groupBy` fields and is uncontrolled by default; pass `groupBy` and `onGroupByChange` to control it from the host, or `initialGroupBy` to only open the board on another grouping (a state grid's choice) without taking the switcher away — the viewer's own choice wins from then on, and an unknown id falls back to the default. Cards load once, so switching the grouping does not refetch. With `editable: true`, moving a card (drag, or the "Move to…" action) is optimistic: only the grouping field is sent with the record's `baseVersion`, and on a 400, 403 or 409 the card goes back, the adapter's message shows and the board reloads. With `doneField` (a boolean field outside the `groupBy` fields), every card gets the component's completion checkbox, written the same one-field way as the calendar's. Select groupings carry each option's `label` (defaulting to its value) and `#RRGGBB` swatch colour on the column. Card labels name each detail field ("Assignee: Ada", not "Ada").
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

A table, calendar or board whose entity declares `actions` and whose view lists `recordActions` shows them per row — offered in the view's order, and only where `availableActions` allows it (the action's `visibleWhen` for the record and viewer, and `can.actions` not saying false). An action with a `confirm` or `input` opens a dialog the renderer builds and draws through the registry's `layout.Dialog` (an optional key; without it a view that needs one gets an error at `/layout/Dialog`). A press runs `adapter.act` with the record's last-read `baseVersion`; the row updates with the record the action returned, including its new `can`, and a removal drops the row. An action nothing may offer is not rendered at all — never greyed out. When the flight ends, focus returns to the pressed control if the browser dropped it to nothing (a disabled button loses focus mid-flight); it never steals focus from a dialog or a viewer who tabbed away, and a removed record leaves focus alone.

```tsx
<TableRenderer entity={change} view={history} registry={registry} dataSources={dataSources} />
```

- **What changed.** A column with `compare` shows its text as a word diff against a neighbouring row or another text field of the record (RFC 0007). The renderer reads the one extra row the first/last cell needs (through `neighbourQuery`, or the previous page's last row for a cursor page), runs `compareCells`, and hands the text `Display` a `diff` prop — the component draws the `<del>`/`<ins>`, the renderer computes nothing into the markup.
- **Datetimes.** A `datetime` cell goes through `formatDateTime` and reaches the `Display` as `text` plus the stored `value`, for a `<time dateTime>`; the raw string is shown only when it is not an instant at all, and the validation error names it then. A from/to quick filter on a datetime field reads the viewer's clock via `instantRangeBounds`.
- **Paging.** A table pages through the registry's optional `layout.Pager` slot when the registry has one; without it the renderer's own Previous/Next markup stays. The renderer owns the page state; the component only draws it.
- **Paging without a count.** A page that answers `total` keeps the numbered pager; one that answers only `next` switches the table to cursor paging — Previous and Next, with the cursors it has visited kept so Previous works even though the server only hands out forward tokens. A change of sort, filter or page size is a new question: the cursor stack clears. There is deliberately no "Load more".

## Reference fields

A `reference` field stores another entity's record id. Pass the documents of the target entities as `entities` (a `Map` by id; a dashboard takes them from `documents.entities`). **Every reference target must be in `entities`.** A target that is missing shows raw ids in the cells (and an error state in the picker) and logs a one-time `yadad:` console warning naming the field and the entity — the screen alone cannot tell an unwired target from data. A host that passes each page a slice of its documents should run core's `validateDocuments` over **that slice**: it reports `unknown-reference` for a reference whose target entity is not in the set. The picker's options (up to 200, sorted by the display field) and the table's labels are read from the **view's own data source**: one adapter serves every entity, so a form or table whose `dataSource` is `"default"` also reads the targets from `"default"`. A table shows the label of each id on the page, the raw id while it loads, and "Unknown" when the record no longer exists. Without `entities`, the picker shows an error state. A reference field may declare `colorFrom`: a text or select field on the target whose value is its colour (a `#RRGGBB` text value, or the colour of the chosen select option). The renderer resolves it and hands the component a `color` hint beside the label; when `colorFrom` is absent, the target failed to load, or the value paints no colour, the existing stable hash slot is the fallback. The colour is never the only signal.

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


## Sub-record checklists (RFC 0009)

A form section that declares `subRecords` renders an inline checklist over a child entity — the rows are ordinary records of that entity, scoped by the back-reference the section names:

```tsx
// view section: { id: "steps", subRecords: { entity: "step", via: "task", titleField: "title", doneField: "done", orderField: "ord" } }
<FormRenderer entity={task} view={form} registry={registry} dataSources={dataSources} parent={taskRecord} documents={documents} />;
```

- Every row write goes through the standard adapter verbs (`create`, `update`, `delete`) under `baseVersion`, like any other record — the checklist is not a field value. Pass the child entity in `entities` or the set in `documents`.
- Add is an input plus a button (Enter works); the new row lands focused, in edit mode, the way the table starts an inline edit. Titles click to edit; the `doneField` checkbox and Remove are one tap each.
- `can.update` and `can.fields` decide what is operable: a locked title shows as text with no edit control.
- A form for a record that does not exist yet renders "Save the task first" instead of writing orphans; a misdeclared section (`doneField` that is not a boolean, `via` that is not a reference) states the problem in place.
- `SubRecordChecklist` is exported for hosts that want the control outside a form.

## The batch composer (RFC 0009)

A create form whose view declares `repeat: "batch"` becomes a queued composer:

```tsx
const view: FormView = { kind: "form", …, repeat: "batch", sections: […] };
<FormRenderer entity={step} view={view} registry={registry} dataSources={dataSources} onSaved={refresh} />;
```

- "+ another" adds an unsaved row; each extra row gets a Remove control. Nothing persists while rows are queued, and drafts never apply to a batch composer — rows live in component state only.
- The single Add flushes every row through `submitBatchCreate` (exported from `@yadad/runtime`): all rows are validated first, then written in ONE adapter `batch` call — all of them land or none do. A row's validation error stays on that row (`/rows/<i>/…`); the other rows keep what was typed.
- A section that declares `subRecords` renders once per composer, not once per queued row.

## DOM hooks for tests and drivers

The renderer owns these attributes; scope a selector with them instead of walking ancestors.

- `data-yadad-table-view="<view id>"` wraps a table view. Inside it, every quick-filter control (every kind, including the two ends of a date or number range) sits in a wrapper with `data-yadad-filter-field="<field id>"`, so `[data-yadad-table-view="sessions"] [data-yadad-filter-field="tags"] input` picks one table's tags filter even when a dashboard renders another.
- `data-yadad-form="<view id>"` is on a form's `<form>`. A batch composer also stamps its view id as the value of `data-yadad-batch-controls`, `data-yadad-batch-count` and `data-yadad-batch-status` (the attribute names are unchanged, so bare `[data-yadad-batch-count]` selectors still match). When the same form renders twice, scope by the host wrapper, for example `[data-yadad-add-form="add_task"] [data-yadad-batch-controls]`.

## Saved filters as chips (RFC 0009)

A table view's `filters` entries render as a chip row beside the quick filters. The renderer holds no chip state — the host owns which chip is lit and persists that choice:

```tsx
<TableRenderer
  entity={entity} view={table} registry={registry} dataSources={dataSources}
  savedFilter={lit} onSavedFilterChange={setLit}
/>;
```

- The lit chip's condition is ANDed into the base filter before the quick filters combine, so it rides the adapter query rather than post-filtering rows.
- Chips are registry `Button`s with the optional `pressed` prop (core): the component draws the pressed look and sets `aria-pressed`. Pressing the lit chip reports `undefined`. An unknown `savedFilter` id filters nothing and lights no chip.

## Drill-downs that have a URL

A table's `rowAction` opens its target in the same container. By default the renderer keeps that stack to itself. Pass `drill` and `onDrillChange` (the same controlled-optional shape as `savedFilter`) and the host owns it, so a drill can live in a URL:

```tsx
<TableRenderer
  entity={entity} view={table} registry={registry} dataSources={dataSources} documents={documents}
  drill={drill} onDrillChange={setDrill}
/>;
```

- `drill` is one `{ viewId, bindings }` per hop from the top-level table. `bindings` holds the clicked row's bound values as text, keyed by the target field id (`rowAction.bind[].to`). Booleans are `Yes`/`No`, a tags value is comma-joined, an empty value is `""`.
- Opening a row and Back call `onDrillChange` with the whole new drill; the renderer shows what `drill` says, so update it in the callback.
- A supplied drill is re-validated level by level through the checks a click goes through (the row action exists and is visible to the viewer, the target is a loaded table, every binding is present and parses). At the first level that fails, the renderer stops there, calls `onDrillChange` with the valid prefix and shows a polite `role="status"` notice (`data-yadad-drill-notice`).
- `DashboardRenderer` keys it by grid item id: `drills={{ [itemId]: drill }}` and `onDrillChange(itemId, drill)`. Every table widget with an entry is controlled; a widget with no entry keeps its private stack, unless `onDrillChange` is set, in which case it starts at the top level and reports under its own id. Entries for widgets on other tabs are kept as they are.
- A controlled Back returns focus to the row (its Open button) the level was opened from, found by its bound values; if that row is not on screen, to the table's heading.
