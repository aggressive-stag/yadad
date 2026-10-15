# RFC 0005: Board view

- Status: Accepted (2026-10-15)
- Touches: `core` (new view kind, validator, `describeContract`, registry types), `runtime` (column building, card query, grouping, move), `renderer` (board renderer, dashboard `view` widget), `testing` (mock registry and contract kit), `editor` (board panel), `apps/showcase`, registry contract (one optional `layout` key); the components repo (the component itself)
- Bumps `specVersion` from 3 to **4** with an identity `migrate()` step (additive) and a before/after fixture pair.

## Summary

Add a `board` view kind: the records of one entity shown as cards in columns, one column per value of a field. The document lists the fields the board may group by (`groupBy`, at least one, the first is the default) and the viewer picks which one is in use. With `editable: true`, moving a card to another column changes the grouping field of that record. Dragging is done by the component (components repo); the engine defines the document, the column and grouping logic, the queries, the move semantics, and the one registry key. Every move also has a non-drag path, a "Move to…" card action, so keyboard, screen-reader and touch users can do everything a pointer user can.

No new field type, no ordering of cards by hand, no swimlanes, and no new data protocol in slice 1.

This RFC deliberately mirrors RFC 0004 (calendar): same optional registry key rule, same move and revert pattern, same accessibility floor, same phasing style. Where the calendar's runtime and renderer details were not final when this was written, this RFC follows RFC 0004's design; the implementing cards should copy the shape the calendar cards actually landed (for example `MovePlan`, the announcement sequence, the notice) and note any difference.

## Motivation

Hosts keep records that pass through states or belong to a group: tasks by status, owner or priority, deals by stage, tickets by assignee, items by list. A table sorted or filtered by that field shows the data but not the shape of the work, and changing the value is a form per record. "Which cards are in which column" is the expected view and dragging a card to another column is the expected edit for a library about drag and drop. The need is general, so it belongs in the library. Letting the viewer switch the grouping (the same tasks by list, by assignee or by flag) is what makes one view cover several uses without one document per use.

## Detailed design

### Document shape

```jsonc
{
  "kind": "board", "specVersion": 4, "id": "tasks_board",
  "title": "Board",
  "entity": "task", "revision": 1, "dataSource": "main",
  "groupBy": [ { "field": "list" }, { "field": "assignee" }, { "field": "flag" } ], // required; 1 to 5; the first is the default
  "titleField": "title",             // text or select; default: the entity's first text field
  "cardFields": ["due", "assignee"], // optional; at most 3; shown small under the title
  "filter": { "op": "neq", "field": "status", "value": "archived" }, // optional fixed Condition, as on tables
  "sort": [ { "field": "title", "dir": "asc" } ],                    // optional; order of cards within a column
  "editable": true,                  // optional; moving a card changes the grouping field; default false
  "rowAction": { "open": "task_history", "bind": [ { "field": "list", "to": "list" } ] } // optional, RFC 0003
}
```

Required: `kind`, `specVersion`, `id`, `entity`, `revision`, `dataSource`, `groupBy`. Everything else is optional. `title` is the accessible name and the heading (default: the entity id).

A `groupBy` entry is an object (`{ "field": "list" }`), not a bare string, so later slices can add per-grouping options (hide empty columns, a column order) without another shape change. Slice 1 allows only `field`.

Types in `core`: `BoardView`, `BoardGroupBy`, `BOARD_GROUP_BY_MAX = 5`, `BOARD_CARD_FIELDS_MAX = 3`; `ViewDocument` gains `BoardView`. `RowAction` is reused unchanged.

### Groupable fields and their columns

A grouping field must be of type `select`, `boolean` or `reference`. Each has a closed, known set of values, which is what a column is.

| Field type | Columns | Notes |
| --- | --- | --- |
| `select` | one per option, in option order | |
| `boolean` | "Yes", "No" | a missing or `null` value counts as "No"; there is no empty column. A `required` boolean (it can only be true) is not groupable |
| `reference` | one per record of the target entity, in the order of the display field ascending, labelled by `display` (as in the reference picker) | see "Reference columns" |

Two extra columns can appear, in this order around the value columns:

- **Empty column**, first, only when the field is **not `required`** (`select`, `reference`): label `No <field label>` (for example "No Assignee"). It holds records whose value is empty. It is a drop target: moving a card there clears the field (`null`).
- **Other column**, last, only when at least one loaded card fits no column: label "Other". It holds records whose value is not one of the columns: a select value no longer in the option list, an empty value on a `required` field (legacy data), a reference to a deleted record or to a record beyond the column cap. It is **not** a drop target (the engine cannot write "other"), but cards in it can be moved out.

Why not text, number and date fields: their values are open sets, so "one column per value" would be unbounded and data-dependent (a column per distinct string, per price), and there is no honest ordering or label for them. A date needs bucketing (overdue, today, this week), which is a different design (a calendar covers dates). They can follow as bucketed groupings later without changing this shape (`groupBy` entries can grow options).

A column has a stable id used in props and moves: `v:<value>` for a value column (`v:Done`, `v:true`, `v:<record id>`), `empty` and `other`. The prefix means a select option can never collide with `empty` or `other`.

### Reference columns

A reference grouping needs the target records. Slice 1 loads them with **one** `find` on the target entity's data source, exactly as the reference picker does (`loadReferenceOptions`), sorted by the display field ascending, with the limit `BOARD_MAX_COLUMNS = 50`.

- **Past the cap:** the first 50 records are columns. Cards that reference any other record go to the "Other" column, and a notice above the board says so: "Showing 50 of 213 Assignee columns. Cards for the others are in Other." Nothing is silently dropped. Raising the cap or searching for a target column is slice 2.
- **Empty columns show.** A column with no cards still renders, because it is a drop target and showing "nobody has this yet" is part of a board. A `hideEmpty` option on a `groupBy` entry is slice 2. (50 columns is why the component must scroll horizontally and offer "Move to…".)
- **Load failure:** `ErrorSummary` with the adapter's message and a "Retry" `Button`; the board renders no columns for that grouping, the group-by choice stays usable so the viewer can switch to another field.
- The target records are loaded once per reference field per renderer instance and per data-source, not on every switch; a reload (see Data loading) re-fetches them.

### Validation and error codes

Same error shape and codes as everywhere (`{ path, code, message, hint }`, JSON Pointer paths); no new code is added. Shape checks run on a single document, referential checks in `validateDocuments`.

Shape (single document):

| Path | Code | When |
| --- | --- | --- |
| `/<key>` | `unknown-property` | any key not listed above |
| `/id`, `/entity`, `/dataSource`, `/revision` | `required` / `type` / `invalid-value` | as for other views |
| `/groupBy` | `required` | missing |
| `/groupBy` | `type` | not an array |
| `/groupBy` | `invalid-value` | empty, or more than 5 entries |
| `/groupBy/<i>` | `type` | not an object |
| `/groupBy/<i>/<key>` | `unknown-property` | any key other than `field` |
| `/groupBy/<i>/field` | `required` / `type` / `invalid-value` | missing / not a string / malformed id |
| `/groupBy/<i>/field` | `invalid-value` | a duplicate of an earlier entry |
| `/titleField` | `type` / `invalid-value` | not a string / malformed id |
| `/cardFields` | `type` | not an array of strings |
| `/cardFields` | `invalid-value` | more than 3 entries |
| `/cardFields/<i>` | `invalid-value` | a duplicate of an earlier entry |
| `/editable` | `type` | not a boolean |
| `/filter`, `/sort`, `/rowAction` | as for a table | same checks as `TableView` |

Referential (`validateDocuments`):

| Path | Code | When |
| --- | --- | --- |
| `/entity` | `unknown-reference` | no such entity in the set |
| `/groupBy/<i>/field` | `unknown-reference` | the entity has no such field |
| `/groupBy/<i>/field` | `invalid-value` | not a `select`, `boolean` or `reference` field (`allowed` lists the entity's groupable fields); or a `required` boolean (hint: a required boolean can only be true) |
| `/titleField` | `unknown-reference` / `invalid-value` | no such field / not `text` or `select` |
| `/titleField` | `required` | omitted and the entity has no `text` field to default to (`allowed` lists text and select fields) |
| `/cardFields/<i>` | `unknown-reference` | no such field |
| `/cardFields/<i>` | `invalid-value` | the same field as the effective title (the explicit `titleField`, else the default). A group-by field may be a card field: the viewer can switch, and a card then still shows its other grouping values |
| `/filter/...` | as for a table | unknown field, or an op not allowed on that field type |
| `/sort/<i>/field` | `unknown-reference` / `invalid-value` | no such field / a `reference` field (not sortable, as on tables) |
| `/rowAction/...` | as for a table | `open` must be a table view; bindings, type compatibility, no cycles, depth 3. A board can be the start of a chain, never a target (counts its own hop, as for calendars) |
| dashboard `/tabs/<t>/items/<i>/view` | `unknown-reference` | a `view` widget now accepts form, table, calendar and board ids (hint updated). `count` and `stat` stay table-only, with a message that names the board |

Warnings: none new.

`describeContract()` lists the kind, its properties and limits, the groupable field types, and `optionalRegistryKeys` gains `layout.Board`; `pnpm describe-registry` prints it.

`migrate()`: 3 to 4 stamps `specVersion: 4`; versions 0 to 3 stay valid. Fixtures: a before/after pair `migrate/` (a spec 3 set and its spec 4 stamp); valid `board-minimal` (required keys, one select grouping), `board-full` (every key, three groupings of the three types), `board-reference-grouping`; invalid, one per row of the tables above (unknown property, missing `groupBy`, empty `groupBy`, six entries, duplicate field, unknown key in an entry, text field as grouping, `required` boolean as grouping, too many `cardFields`, `cardFields` equal to the title, missing `titleField` with no text field, `count` widget pointing at a board, `rowAction` target that is not a table).

### Data loading

One query for the cards, independent of the grouping, issued by `loadBoardCards` through `DataAdapter.find` (no new adapter method, no new protocol endpoint):

- `filter` = the view `filter`, relative dates resolved with `resolveRelativeDates` (D22). No grouping condition: all records come back and are grouped on the client, so switching the grouping does not refetch.
- `sort` = `view.sort ?? [{ field: titleField, dir: "asc" }]`. This is the order of cards inside each column.
- `page`: `limit` 500 (`BOARD_PAGE_SIZE`, the protocol maximum), `offset` 0. If the first page's `total` is above 500, the second page is requested in parallel, then results are de-duplicated by record id (data can shift between pages).
- **Cap:** `BOARD_MAX_CARDS = 1000` (two pages). `BoardLoad` is `{ records, total, truncated }`. Past the cap the viewer sees a notice: "Showing the first 1,000 of 1,412 cards. Narrow the filter." Cards are never silently dropped, but column counts then cover only the loaded cards. Because the query is not sorted by the grouping field, a cut-off is by the view sort, not per column; per-column paging (one `find` per column with a "Load more") is slice 2.
- **Loading and staleness:** a new request starts when the view, the data source or the host's `reloadKey` changes, and after a failed move. A response for a request that is no longer current is discarded (a sequence number). While loading, the columns are shown with no cards and `loading: true` when they are known; the previous cards are not kept.
- **Errors:** a failed load shows an `ErrorSummary` with the adapter's message and a "Retry" `Button`.
- No caching in slice 1.
- Card detail fields of type `reference` are labelled by the renderer through the existing reference lookup, as table cells are.

Total requests for a first paint: 1 to 2 for cards, plus 1 for a reference grouping's columns.

### Cards

Each loaded record is a card. Its title is the `titleField` value (a blank title shows "(untitled)"). Its details are `cardFields`, drawn with each field's registry `Display`, as table cells are. Its accessible `label` is plain text: the title, then each detail as `<field label>: <text>`. The column is not repeated on the card (the component names it).

### Grouping logic (`runtime`, pure, in `board.ts`)

All functions are pure or take an adapter, and are unit-tested without a DOM.

```ts
interface BoardColumnDef {
  id: string;                       // "v:<value>", "empty" or "other"
  kind: "value" | "empty" | "other";
  label: string;
  value: FieldValue;                // what a move writes: the option, true/false, a record id; null for "empty"; unused for "other"
}
interface BoardLoad { records: DataRecord[]; total: number; truncated: boolean }

BOARD_PAGE_SIZE = 500; BOARD_MAX_CARDS = 1000; BOARD_MAX_COLUMNS = 50;

boardGroupField(view, entity, requested?): Field
boardGroupChoices(view, entity): { field: string; label: string }[]
boardColumns(field, targets?): BoardColumnDef[]
boardQuery(view): Query
loadBoardCards(adapter, view, options?): Promise<BoardLoad>
loadBoardTargets(adapter, targetEntity, field): Promise<{ options: ReferenceOption[]; more: boolean }>
groupByColumn(field, columns, records): Map<string, DataRecord[]>
moveCard(view, entity, record, column): MovePlan
```

- `boardGroupField` returns the field named by `requested` if it is one of the view's `groupBy` fields, else the first. An unknown or stale request falls back to the default and never throws.
- `boardColumns` builds the value columns, then adds `empty` when the field is not required, in the order described above; `other` is added by `groupByColumn` only when needed, so it is returned in the map and by a small helper the renderer uses. `targets` is the loaded reference options (`boardColumns` of a reference field without them returns no columns).
- `groupByColumn` keeps the input order inside each column (the adapter's sort) and puts each record in the column of its value, in `other` when none fits.
- `loadBoardTargets` wraps `loadReferenceOptions` with the limit `BOARD_MAX_COLUMNS`.
- `moveCard` is the board's `moveDay` (same `MovePlan` shape the calendar runtime landed): it returns `{ call, patch, noop }` for the update below, and is a no-op when the card is already in that column, or `rejected` with a reason when the target is `other`.

### Moving a card

Available only when `editable: true` (otherwise `onMove` is not passed and cards are not movable). The same function serves a pointer drag and "Move to…".

1. **The call:** `adapter.update(entity, record.id, { [groupField]: column.value }, { entityRevision: entity.revision, baseVersion: record.version })`. Only the grouping field is sent. `column.value` is the option string, `true`/`false`, the reference record id, or `null` for the empty column. Moving to the card's current column does nothing and sends nothing. Moving to `other` is refused locally (the component must not offer it; if `onMove` is called with it anyway the renderer announces why and does nothing).
2. **Optimistic:** the renderer patches the record's value in its local list, removes the card from its place and appends it at the end of the target column, with `pending: true`. A pending card is not movable (never two writes in flight for one record). Switching the grouping while a move is pending is fine: the patched value is on the record, so the card shows in the right column of any grouping.
3. **Success:** the returned record replaces the old one (new `version`). No reload, so the card stays last in its new column until the next load re-sorts it. The live region announces "Moved Pay rent to In progress".
4. **Failure** (400 validation, 401, 403, 404, 409 conflict, network): the record's old values are restored and the card returns to its old index, an `ErrorSummary` above the board shows the adapter's message (for 400 the `issues`), the live region announces "Could not move Pay rent: <message>", and the cards are **reloaded** so the board shows the server's state (for a 409 this fetches the current record; no automatic retry or merge). The server has the final say.
5. **No client-side permission checks.** The client does not guess what a user may do; the adapter or server says no with 403 and the above happens. (The one local check: the target must be a droppable column of the current grouping.)
6. **No ordering within a column.** Position inside a column comes from `sort`. Dropping between two cards means nothing in slice 1: it is a move to the column. Manual order needs a stored rank field, which is a later slice (below).
7. Moves never touch `revision` bookkeeping beyond the `baseVersion` above and never write the view document (D5).

A move changes exactly one field, the one in use. A workflow rule such as "a card cannot go from Done to Todo" is not expressed in the document; the server may refuse with 400 or 403 and the revert path handles it. Status workflows are a later slice.

### Switching the grouping

The component shows a group-by control (a labelled select or segmented control) when the view has more than one `groupBy` entry. Choosing a field calls `onGroupBy(field)`.

- The renderer keeps the viewer's choice in state, **uncontrolled by default**. The first entry is the initial one.
- A host that wants to persist or deep-link it passes the optional **controlled** props `groupBy?: string` (a field id) and `onGroupByChange?: (field: string) => void` to the board renderer. When `groupBy` is set it wins; an id that is not one of the view's grouping fields falls back to the default. The renderer calls `onGroupByChange` on every viewer choice, controlled or not. The document never stores the viewer's choice, only the allowed set and the default order; the editor and agents write documents, hosts write viewer state.
- Switching regroups the loaded cards in memory (no card refetch). A reference grouping loads its columns if they are not loaded yet; `columns` is empty and `loading` is true meanwhile.
- The live region announces "Grouped by Assignee, 5 columns".
- In a dashboard cell the choice is uncontrolled (the dashboard does not pass it through in slice 1).

### Opening a card (`rowAction`)

`rowAction` is the table's, unchanged (RFC 0003): with it set, activating a card (click, Enter on its title) opens the target table view scoped by the bindings, replacing the board in its container with a Back control. `bindFilter(record.values, bindings, targetFilter)` from `runtime` is reused as is. The board's group-by choice, loaded cards and columns are kept above the board so Back returns to the same state. Without `rowAction`, cards are plain text (still focusable through their "Move to…" action when editable).

### Registry contract

One new **optional** layout key. Types live in `core/src/registry.ts`, next to `CalendarProps`.

```ts
interface Registry<N> {
  readonly layout: {
    /* ...existing keys... */
    readonly Board?: Component<BoardProps<N>, N>;      // key: "layout.Board"
  };
}

interface BoardCard<N> {
  readonly id: string;                                  // the record id
  readonly content: N;                                  // title and card fields, built by the renderer
  readonly label: string;                               // plain-text accessible name: title and details
  readonly movable: boolean;                            // editable and not pending
  readonly pending: boolean;                            // a move is in flight
}

interface BoardColumn<N> {
  readonly id: string;                                  // "v:<value>", "empty" or "other"
  readonly label: string;                               // "In progress", "Yes", "No Assignee", "Other"
  readonly count: number;                               // cards in `cards` (the loaded cards)
  readonly droppable: boolean;                          // false for "other"; always true otherwise
  readonly cards: readonly BoardCard<N>[];              // all of the column's cards, in sort order
}

interface BoardGroupChoice {
  readonly field: string;                               // field id
  readonly label: string;                               // the field label
}

interface BoardProps<N> {
  readonly label: string;                               // accessible name of the whole board (the view title)
  readonly groupChoices: readonly BoardGroupChoice[];   // length 1: no switcher
  readonly groupField: string;                          // the choice in use
  readonly columns: readonly BoardColumn<N>[];          // in display order; empty while columns are loading or failed
  readonly loading: boolean;                            // cards or columns are being fetched
  readonly notice?: N;                                  // over-cap and column-cap messages; shown above the board, announced politely
  readonly announcement?: { readonly seq: number; readonly text: string };  // for the component's live region
  readonly onGroupBy: (field: string) => void;
  readonly onOpenCard?: (recordId: string) => void;     // set only when the view has a rowAction
  readonly onMove?: (recordId: string, columnId: string) => void;  // set only when the view is editable
}
```

`ErrorSummary`, the load-error "Retry" `Button` and the notices are rendered by the renderer, not the component. `onMove` takes any column id; the renderer ignores a move to the card's own column, refuses `other`, and handles everything else per "Moving a card". `announcement.seq` increases on every message so an identical message is announced again. Strings the renderer composes (column labels such as "Yes", "No Assignee", "Other"; notices; announcements) are English, like every other engine message; button text inside the component (Move to…, the group-by label, column navigation) belongs to the component.

The component finds the "other columns" for "Move to…" from `columns` itself: every column with `droppable` except the card's own. The "current column" of a card is the column that contains it.

**Compatibility: the key is optional in slice 1,** for the reason RFC 0004 gives: a required key would force every existing registry (published base set and every host's own) to change in lock-step for a view kind most documents will not use. A board document with a registry that lacks the key renders an `ErrorSummary` ("This registry has no layout.Board component, so the board view <id> cannot be shown.", code `required`, path `/layout/Board`). `@yadad/testing`'s mock registry supplies a board and the contract kit tests it. The key becomes required on the same terms as `layout.Calendar` (once the reference component set ships it, in the next minor); until then `describe-registry` marks it optional.

### Component requirements (components repo)

The renderer owns data, grouping, optimistic state and announcements. The component owns drawing and all drag code (no drag code in the renderer); a drag library may be used there (components repo only). Required of the component:

- **Layout by container width, not viewport,** so it works in a dashboard cell. Wide enough: columns side by side in a horizontally scrolling region, each column scrolling its own cards if the host limits the height. **Narrow (phone): one column fills the width and the others are reached by horizontal scroll with snap** (`scroll-snap-type: x mandatory`, one column per snap point), with a column indicator ("In progress, 2 of 4") and previous/next controls that are also buttons, so a column can be reached without swiping. Same props either way.
- **Semantics:** the board is a `role="group"` named by `label`; each column is a `role="group"` (or region) named `"<column label>, <count> cards"` with its cards in a list; card titles are headings or buttons (links), named by `label`. Tab order is DOM order: group-by control, then each column's cards. The scroll region is keyboard scrollable (focusing a card scrolls it into view). Counts are text, not colour. Targets at least 24 by 24 CSS px; focus rings and forced-colors support as in the rest of the base set.
- **Group-by control:** a labelled `<select>` or a radio group named "Group by", present only when `groupChoices.length > 1`, selected value `groupField`, calling `onGroupBy`. Focus stays on it after a change.
- **Moving:** every `movable` card has a **"Move to…"** action, always in the DOM and focusable (not shown only on hover), at least 24 by 24 CSS px, that opens a labelled list (a menu or a dialog with radio options) of the `droppable` columns other than the card's own, and calls `onMove(id, columnId)` on choosing; Escape cancels and focus returns to the "Move to…" action. This is the keyboard, touch and screen-reader path and is required whenever `onMove` is set. After a move the card's DOM node is kept (keyed by `id`) or focus is restored to the card in its new column, so focus is never lost; on revert the same applies. On a phone it is the primary path.
- **Drag** (pointer): a movement threshold of about 4 px before a drag starts so a click still opens; touch drags start after a long press so scrolling and column snapping still work; the horizontal region auto-scrolls while a card is dragged near its edges; the target column is highlighted and `other` is not highlighted or accepted; Escape or dropping outside a column cancels; dropping calls `onMove(id, columnId)` exactly once. Dropping on a position between cards is a drop on the column. Pending cards are not draggable. Respect `prefers-reduced-motion`. Keyboard drag (Space, arrows, Space) is optional.
- **Live region:** a `role="status"` `aria-live="polite"` element, always mounted, showing `announcement.text`; the board is `aria-busy` while `loading`. Outcomes are announced through `announcement`, never invented in the component.
- An axe test in the components repo for the wide and the narrow layouts, with the "Move to…" list open.

### Dashboards

The existing `view` widget embeds a board like it embeds a table or calendar: `{ "widget": "view", "view": "tasks_board" }`. A board renders in the cell with the cell's size, so the component's container-width layout is what makes a small cell usable; the editor suggests at least 8 columns by 8 rows but does not enforce it. A board `rowAction` inside a cell replaces the cell's contents with Back, as for tables. `count` and `stat` widgets stay table-only: "tasks in a status" as a number is a table view with the same filter. The group-by choice is uncontrolled inside a cell.

### Renderer

`renderer` adds a board renderer (props: `entity`, `view`, `registry`, `dataSources`, `entities`, `documents`, `reloadKey`, as for the table and calendar renderers, plus the optional `groupBy` and `onGroupByChange`), used for a board document on its own and inside a dashboard `view` widget. It holds the state: the group choice, loaded cards, loaded reference columns, pending moves, the announcement sequence. It calls the runtime functions above, builds cards with the field `Display` components, and passes `BoardProps` to `registry.layout.Board`. It never imports a component and contains no drag code. Tests use the mock registry (D20): card load query and paging, over-cap notice, grouping by select, boolean and reference, empty and other columns, switching without refetch, controlled and uncontrolled `groupBy`, reference-column cap notice and load error, optimistic move, revert and reload on 400/403/409, move refused to `other`, missing-key `ErrorSummary`, rowAction opening and Back, embedded in a dashboard.

### Editor

A board panel in `editor`, emitting JSON Patch like the table panel. Scope for slice 1:

- "New board view" in the blank-view creator: pick an entity that has at least one groupable field; `groupBy` starts with the first groupable field, `titleField` is left to its default.
- `groupBy`: a list of the entity's groupable fields (select, boolean and reference, `required` booleans left out), add and remove (at least one stays, at most 5), with the existing reorder buttons; the first is the default grouping and is labelled so.
- Pickers: `titleField` (text or select), `cardFields` (up to 3, any field except the title field, with reorder buttons).
- `editable` checkbox; `filter`: the existing condition builder; `sort`: the table's sort editor; `rowAction`: the table's Row action section, reused as is.
- The dashboard editor's `view` widget picker lists board views.
- Every picker is generated from the same lists the validator uses; invalid combinations are not offered. No live preview of the board in slice 1.

### Documents, runtime and renderer fit the hard rules

- No component names or file paths: `layout.Board` is a registry key; a view id is an id.
- No escape hatches: a closed shape, no string expressions, no props bag, no index signatures; column ids are derived, not authored.
- Documents are the contract: which fields may group, which is default, what a move changes and whether it is allowed are in the document; the component never special-cases it.
- Dependency direction: types and validation in `core`; columns, queries, grouping and move planning in `runtime` (no `react`); state in `renderer`; drag in the components repo.

## Alternatives considered

- **A table grouped by a field.** No engine change, but no columns and no drag between them, which is the point.
- **Calendar and board as one "grouped" view** (a calendar is a board whose columns are days). The move semantics are the same (write one field to the bucket's value), and `moveCard` deliberately mirrors `moveDay`. But range paging, week geometry and navigation differ from fixed columns and a per-viewer grouping; two small closed views are easier to validate than one open one (the same call RFC 0004 made).
- **One `find` per column.** Exact per-column totals and paging, but N requests for a reference grouping, and switching the grouping would refetch everything. One query with client-side grouping is simpler and bounded by the 1,000-card cap; per-column paging is slice 2.
- **A `groupBy` condition pushed to the server** (filter per column). Same as above; the grouping stays visible as data on the client rather than as 50 conditions.
- **The viewer's grouping stored in the document.** The document is shared and written by the editor; one viewer's choice would change it for everyone. Viewer state belongs to the host, hence the optional controlled props.
- **`groupBy` as a bare field id, or a single `groupBy` field.** A single field cannot be switched by the viewer, which the owner wants; objects leave room for per-grouping options.
- **Grouping by text, number or date fields in slice 1.** Open value sets; see "Groupable fields".
- **Bundling a kanban library in the engine.** It would bring its own data model and styling into `renderer`, against "documents are the contract". A components-repo implementation may use a drag library inside the component.
- **Drag code in the renderer.** Keyboard and touch would need redoing per registry. The engine therefore only defines `onMove`.
- **Making `layout.Board` required.** See the compatibility paragraph.
- **Ordering cards by hand now.** Needs a stored rank (a number or fractional string) that the user must add to their entity, an insert position in the move call and rank-rebalancing rules; see Phasing.

## Phasing

**Slice 1** (the cards that follow this RFC):

1. `core`: `board` view kind, validation and error rows above, `describeContract`, `specVersion` 4 and `migrate()`, fixtures, registry types (`BoardProps`, optional `layout.Board`).
2. `runtime`: `board.ts` (columns, `boardQuery`, `loadBoardCards`, `loadBoardTargets`, `groupByColumn`, `moveCard`), unit tests.
3. `renderer` and `testing`: the board renderer with the controlled/uncontrolled `groupBy`, the dashboard `view` widget, the mock registry's board and contract-kit tests.
4. `showcase`: a board view in the demo set, grouped by a select, a reference and a boolean, with a dashboard tab embedding it.
5. `editor`: the board panel.
6. Components repo: the `layout.Board` component (columns, cards, group-by control, "Move to…", phone column snap, drag).

**Slice 2:** `quickFilters` on boards (the viewer narrowing cards, as on tables; the group-by control is the viewer's main control for now), `hideEmpty` and a column order option on `groupBy` entries, per-column paging ("Load more") and per-column totals, a searchable column picker and a higher column cap for large reference sets, column collapse, create-a-card-in-a-column (new record with the column's value prefilled), card colour (`colorField`), count/stat widgets per column.

**Later, each its own `specVersion` step:** manual order inside a column (`rankField`, a stored sortable value, insert position in the move, rebalancing), status workflows (allowed transitions, validated by the document and the server), swimlanes (a second `groupBy` axis), bucketed groupings for date and number fields.

Where I would stop: one field places a card in one column; the only edit is moving it to another column; the viewer picks which of a few listed fields groups the board; no order by hand, no workflow, no swimlanes.

## Decision (2026-10-15)

Accepted. The owner accepted the direction; the design calls were made while writing it, and these are the ones to check:

1. `groupBy` is a required array of 1 to 5 `{ field }` objects; the first is the default; fields are `select`, `boolean` (not `required`) or `reference`.
2. Columns: select options in order, "Yes"/"No" (missing is No), reference records (display ascending, capped at 50, one `find`); "No <label>" first when the field is not required; "Other" last for cards that fit no column, not a drop target.
3. Empty columns always show in slice 1.
4. One card `find` (500 per page, capped at 1,000, visible notice), grouped on the client; switching the grouping does not refetch.
5. A move is `update(..., { [groupField]: value }, { baseVersion })` (`null` for the empty column), optimistic and appended last in the target column, reverted and reloaded on any failure, with no client-side permission checks. No ordering within a column.
6. The viewer's group-by choice is renderer state, uncontrolled by default, with optional `groupBy` / `onGroupByChange` for hosts; never in the document.
7. `layout.Board` is optional in slice 1; a missing component gives an `ErrorSummary`.
8. Drag is the component's; "Move to…" is the required non-drag path (the primary one on a phone, with column snap).
9. `rowAction` is reused unchanged; a board can start a chain, never be a target. `quickFilters` and `colorField` wait for slice 2.

## Open questions for the owner

1. Is hiding no columns acceptable for large reference sets (50 mostly empty columns), or should `hideEmpty` be in slice 1?
2. Is a cap of 1,000 cards for the whole board right, given counts are then partial, or should per-column paging come first?
3. Should a moved card sit last in its new column until the next load (as written), or should the renderer re-sort it locally into its sort position?
4. Should `layout.Board` follow `layout.Calendar` and become required in the same minor once the reference component set ships both?

### Answers (2026-10-15)

1. No `hideEmpty` in slice 1. Empty columns always show; slice 2 adds the option alongside `quickFilters`. The 50-column reference cap and its notice cover the worst case meanwhile.
2. 1,000 cards stays the slice-1 cap, with the notice saying column counts may be partial. Per-column paging comes later if a host needs it.
3. Re-sort locally: a moved card takes the position the view's `sort` gives it in the new column, so it doesn't jump when the cards reload. With no `sort`, it goes last.
4. Yes. `layout.Board` and `layout.Calendar` become required together, in the same minor release, once the reference component set ships both.
