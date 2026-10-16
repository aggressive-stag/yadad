# RFC 0004: Calendar view

- Status: Accepted (2026-10-15); Slice 1 implemented (2026-10-16) — `core`, `runtime`, `renderer`/`testing`, `showcase` and `editor` (the calendar panel, card 12) are all done. Only item 6, the components-repo `layout.Calendar` component, remains outside this repo.
- Touches: `core` (new view kind, validator, `describeContract`, registry types), `runtime` (range math, range queries, move), `renderer` (calendar renderer, dashboard `view` widget), `testing` (mock registry and contract kit), `editor` (calendar panel), `apps/showcase`, registry contract (one optional `layout` key); the components repo (the component itself)
- Bumps `specVersion` from 2 to **3** with an identity `migrate()` step (additive) and a before/after fixture pair.

## Summary

Add a `calendar` view kind: the records of one entity placed on the days of a month or week by one `date` field. With `editable: true`, moving an entry to another day changes that field. Dragging is done by the component (components repo); the engine defines the document, the range math and queries, the move semantics, and the one registry key. Every move also has a non-drag path, a "Move to day…" action, so keyboard, screen-reader and touch users can do everything a pointer user can.

No new field type, no recurrence, no time of day, no multi-day spans in slice 1.

## Motivation

Hosts keep records that belong to a date: tasks with a due date, bookings, visits, workouts, expenses. The only way to show them today is a table sorted by date. "What is on which day" is the expected view, and dragging an entry to another day is the expected edit for a library about drag and drop. The need is general (a task app, a booking list, a visit schedule), so it belongs in the library rather than in a host.

## Detailed design

### Document shape

```jsonc
{
  "kind": "calendar", "specVersion": 3, "id": "tasks_calendar",
  "title": "Calendar",
  "entity": "task", "revision": 1, "dataSource": "main",
  "dateField": "due",                // required; a `date` field of the entity
  "titleField": "title",             // text or select; default: the entity's first text field
  "detailFields": ["assignee"],      // optional; at most 3; shown small under the title
  "colorField": "list",              // optional; a select or reference field
  "filter": { "op": "neq", "field": "status", "value": "done" }, // optional fixed Condition, as on tables
  "sort": [ { "field": "title", "dir": "asc" } ],                // optional; order of entries within a day
  "modes": ["month", "week"],        // optional; non-empty, no duplicates; first is the default; default ["month", "week"]
  "weekStartsOn": 1,                 // optional; 0 (Sunday) to 6; default 1 (Monday)
  "editable": true,                  // optional; moving an entry changes dateField; default false
  "rowAction": { "open": "task_history", "bind": [ { "field": "list", "to": "list" } ] } // optional, RFC 0003
}
```

Required: `kind`, `specVersion`, `id`, `entity`, `revision`, `dataSource`, `dateField`. Everything else is optional. `title` is the accessible name and the heading (default: the entity id).

Types in `core`: `CalendarView`, `CALENDAR_MODES = ["month", "week"] as const`, `CalendarMode`; `ViewDocument` gains `CalendarView`. `RowAction` is reused unchanged. A `day` mode is deliberately not offered (see Phasing): on a phone the component shows an agenda for the same range, which is a rendering choice and not a document mode.

### Validation and error codes

Same error shape and the same codes as everywhere (`{ path, code, message, hint }`, JSON Pointer paths); no new code is added. Shape checks run on a single document, referential checks in `validateDocuments`.

Shape (single document):

| Path | Code | When |
| --- | --- | --- |
| `/<key>` | `unknown-property` | any key not listed above |
| `/id`, `/entity`, `/dataSource`, `/dateField`, `/revision` | `required` / `type` / `invalid-value` | as for other views (ids match the id pattern; `revision` is a positive integer; `dataSource` non-empty) |
| `/dateField`, `/titleField`, `/colorField` | `type` | not a string; or an invalid id |
| `/detailFields` | `type` | not an array of strings |
| `/detailFields` | `invalid-value` | more than 3 entries |
| `/detailFields/<i>` | `invalid-value` | a duplicate of an earlier entry |
| `/modes` | `type` | not an array |
| `/modes` | `invalid-value` | empty array |
| `/modes/<i>` | `invalid-value` | not `"month"` or `"week"` (`allowed` lists them), or a duplicate of an earlier entry |
| `/weekStartsOn` | `type` | not a number |
| `/weekStartsOn` | `invalid-value` | not an integer from 0 to 6 |
| `/editable` | `type` | not a boolean |
| `/filter`, `/sort`, `/rowAction` | as for a table | same checks as `TableView` (condition AST and depth, sort entries and direction, row action shape) |

Referential (`validateDocuments`):

| Path | Code | When |
| --- | --- | --- |
| `/entity` | `unknown-reference` | no such entity in the set |
| `/dateField` | `unknown-reference` | the entity has no such field |
| `/dateField` | `invalid-value` | the field is not of type `date` (`allowed` lists the entity's date fields) |
| `/titleField` | `unknown-reference` / `invalid-value` | no such field / not `text` or `select` |
| `/titleField` | `required` | omitted and the entity has no `text` field to default to (hint: set `titleField` to a select field) |
| `/detailFields/<i>` | `unknown-reference` | no such field |
| `/detailFields/<i>` | `invalid-value` | the same field as `dateField` or `titleField` |
| `/colorField` | `unknown-reference` / `invalid-value` | no such field / not `select` or `reference` |
| `/filter/...` | as for a table | unknown field, or an op not allowed on that field type (including relative dates on non-date fields) |
| `/sort/<i>/field` | `unknown-reference` / `invalid-value` | no such field / a `reference` field (not sortable, as on tables) |
| `/rowAction/...` | as for a table | `open` must be a table view; bindings, type compatibility, no cycles, depth 3. A calendar can be the start of a chain, never a target |
| dashboard `/tabs/<t>/items/<i>/view` | `unknown-reference` | a `view` widget now accepts form, table and calendar ids (hint updated). `count` and `stat` stay table-only: a calendar id there is `unknown-reference` with the hint "Point at a table view" |

Warnings: none new. `sort` is meaningful but optional; a calendar with no entries is not a document problem.

`describeContract()` lists the kind, its properties (with the defaults above), the modes, and the widget hint. `pnpm describe-registry` also lists `layout.Calendar` as optional.

`migrate()`: 2 to 3 stamps `specVersion: 3`; version 0, 1 and 2 documents stay valid. Fixtures: a before/after pair `migrate/` (a spec 2 set and its spec 3 stamp), valid `calendar-minimal` (required keys only), `calendar-full` (every key), `calendar-week-only`; invalid: one per row of the tables above (unknown property, empty modes, duplicate mode, `weekStartsOn: 7`, too many `detailFields`, `dateField` of the wrong type, missing `titleField` with no text field, `colorField` of the wrong type, `count` widget pointing at a calendar, `rowAction` target that is not a table).

### Dates, time zones and "day"

The engine has only the `date` field type: a calendar date, `"YYYY-MM-DD"`, with no time and no zone. Slice 1 uses exactly that.

- A record's day is its `dateField` string. Nothing is converted, so there is no time zone problem: the same record is on the same day for every viewer and every server.
- "Today" is the viewer's local date (the same rule as `daysFromToday`, D22), taken from an injectable `now` so tests are deterministic.
- All day arithmetic in `runtime` is on calendar dates (year, month, day via `Date.UTC` internally), never on local midnights, so daylight-saving changes cannot shift or repeat a day.
- Records with an empty `dateField` are never shown in slice 1 (they cannot match the range query). An "undated" tray is slice 2.
- Time of day, a `time` field type, `dateTime` and multi-day spans are out of scope (Phasing). They are additive later: a `timeField` or `endField` property and a new field type, each with its own `specVersion` step.

### Range math (`runtime`, pure, in `calendar.ts`)

Everything is a pure function over `"YYYY-MM-DD"` strings and numbers, unit-tested without a DOM. `anchor` is any date inside the period being shown; the renderer keeps it in state.

```ts
type CalendarMode = "month" | "week";                 // re-exported from core
interface CalendarDay { date: string; dayOfMonth: number; weekday: number; inMonth: boolean; isToday: boolean }
interface DateRange { first: string; last: string }   // inclusive

visibleDays(anchor, mode, weekStartsOn, today): CalendarDay[]
visibleRange(anchor, mode, weekStartsOn): DateRange
shiftAnchor(anchor, mode, direction: -1 | 1): string
periodTitle(anchor, mode, weekStartsOn, locale?): string
weekdayLabels(weekStartsOn, locale?): { short: string; long: string }[]
dayLabel(date, locale?): string
rangeCondition(dateField, range, filter?): Condition
calendarQuery(view, range): Query
loadCalendarRange(adapter, view, range, options?): Promise<CalendarLoad>
groupByDay(records, dateField): Map<string, DataRecord[]>
moveDay(view, entity, record, day): MovePlan
colorSlot(value, fieldKind, options?): number | undefined
```

Rules:

- **Month:** `visibleDays` always returns **42 days** (six whole weeks) starting on the `weekStartsOn` day on or before the 1st of the anchor's month, so the grid keeps its height while navigating. Days outside the anchor's month have `inMonth: false` (leading and trailing days); they are real days, show their entries and accept moves. **Week:** 7 days from the `weekStartsOn` day on or before the anchor, all `inMonth: true`.
- `visibleRange` is the first and last of those days. A month range therefore includes the leading and trailing days.
- `shiftAnchor`: month goes to the 1st of the previous or next month; week moves by 7 days. "Today" is `anchor = today`, done by the renderer. Switching mode keeps the anchor.
- `periodTitle`: "October 2026" for a month; for a week "5 to 11 October 2026" (both months and, if needed, both years named), formatted with `Intl.DateTimeFormat` in UTC on the date parts. `dayLabel` is the long form ("Thursday 15 October 2026") used in accessible names. `locale` defaults to the host's.
- Invalid input (a string that is not a real calendar date, a `weekStartsOn` outside 0 to 6) throws `RangeError`; the validator already stops it reaching here.

### Data loading

One logical load per visible range, issued by `loadCalendarRange` through `DataAdapter.find` (no new adapter method, no new protocol endpoint):

- `filter` = `and(view.filter (relative dates resolved with resolveRelativeDates), gte(dateField, first), lte(dateField, last))`. With no view filter, just the two range comparisons. The result is therefore also exactly what a table with the same filter and the same two quick-filter bounds would show. Adapters already treat an empty value as matching neither `gte` nor `lte`; the adapter conformance suite gets a case for it in the runtime card, so undated records are provably excluded.
- `sort` = `[{ field: dateField, dir: "asc" }, ...(view.sort ?? [{ field: titleField, dir: "asc" }])]`. Date first means a cap, if hit, cuts off the latest days and never a random subset; the rest is the order within a day.
- `page`: `limit` 500 (the protocol maximum, `CALENDAR_PAGE_SIZE`), `offset` 0. If the first page's `total` is above 500, the remaining pages are requested in parallel with their offsets, up to the cap, and de-duplicated by record id (data can shift between pages).
- **Cap:** `CALENDAR_MAX_RECORDS = 2000` records per range. `CalendarLoad` is `{ records, total, truncated }`; `truncated` is true when `total` exceeds what was read. A month of 2,000 entries is not usable on screen anyway; the cap bounds requests (at most 4) and memory.
- **Past the cap**, the viewer sees a notice above the grid (the renderer passes it as `notice`): "Showing the first 2,000 of 2,431 entries in this range. Switch to a week or narrow the filter." Entries are never silently dropped. If the view offers a `week` mode the notice says so, otherwise it only suggests narrowing.
- **Loading:** a new request starts whenever the range, the view or the data source changes. A response for a range that is no longer current is discarded (a sequence number), so quick prev/next clicks cannot show the wrong month. While loading the grid is shown with no entries and `loading: true`; the previous entries are not kept (they would sit on the wrong days).
- **Errors:** a failed load shows an `ErrorSummary` with the adapter's message above the grid, and a "Retry" `Button`; the grid stays navigable.
- No caching or prefetching in slice 1. Re-entering a range reloads it.
- An entry's `colorField` of type `reference` needs the referenced records' labels; the renderer resolves them with the existing reference lookup (as for table cells) for the values present in the range only. A failed lookup falls back to the raw id.

### Entries and colour

Each loaded record becomes an entry on the day in its `dateField`. Its title is the `titleField` value (a blank title shows "(untitled)"). Its details are `detailFields`, drawn with each field's registry `Display`, exactly as table cells are, so formats are consistent.

`colorSlot` turns the `colorField` value into a number from 0 to 7 (`CALENDAR_COLOR_SLOTS = 8`): for a select, the index of the value in its option list modulo 8; for a reference, a stable hash (FNV-1a 32-bit) of the record id modulo 8; an empty value has no colour. The registry component maps slots to its own colours through per-component CSS variables (D15) that default to existing theme tokens; the engine names no colour. Colour is never the only signal: each entry's accessible label includes the colour value's text, and the `legend` lists slot and text for the values present in the range (select: option order; reference: label order).

### Moving an entry

Available only when `editable: true` (otherwise `onMove` is not passed and entries are not movable). The same function serves a pointer drag and "Move to day…".

1. **The call:** `adapter.update(entity, record.id, { [dateField]: day }, { entityRevision: entity.revision, baseVersion: record.version })`. Only the date field is sent; every other field is untouched. Moving to the entry's current day does nothing and sends nothing.
2. **Optimistic:** the entry moves to the new day at once with `pending: true`. A pending entry is not movable (so there is never a second write in flight for one record) and the grid announces nothing else about it until the call settles.
3. **Success:** the returned record replaces the old one (new `version`). No reload. If the new day is outside the visible range the entry leaves the grid, and the announcement says where it went ("Moved Pay rent to Tuesday 3 November 2026").
4. **Failure** (400 validation, 401, 403, 404, 409 conflict, network): the entry returns to its old day, an `ErrorSummary` above the grid shows the adapter's message (for 400 the `issues`), the live region announces "Could not move Pay rent: <message>", and the range is **reloaded** so the grid shows the server's state (for a 409 this fetches the current record; there is no automatic retry or merge, and the viewer can drag again).
5. **No client-side permission checks.** The client does not guess what a user may do; the adapter or server says no with 403 and the above happens. (The one data rule checked locally is the date field's own `min`/`max`: a day outside it is not sent, the entry stays put, and the announcement says why. The server still enforces it.)
6. Moves do not touch `revision` or `version` bookkeeping beyond the `baseVersion` above, and never write the view document (D5: pages write records, the editor writes documents).

### Opening an entry (`rowAction`)

`rowAction` is the table's, unchanged (RFC 0003): with it set, activating an entry (click, Enter) opens the target table view scoped by the bindings, replacing the calendar in its container with a Back control, and `onOpenView` (when RFC 0003 slice 2 lands) reports it to a host the same way. `bindFilter(record.values, bindings, targetFilter)` from `runtime` is reused as is. The calendar's own mode, anchor and loaded range are kept above the calendar so Back returns to the same month. When RFC 0003's form target (`edit`) ships, calendars get it for free through the shared `RowAction` type; this RFC adds nothing to it. Without `rowAction`, entries are plain text (still focusable through their "Move to day…" action when editable).

### Registry contract

One new **optional** layout key. Types live in `core/src/registry.ts`, next to `TableProps`.

```ts
interface Registry<N> {
  readonly layout: {
    /* ...existing keys... */
    readonly Calendar?: Component<CalendarProps<N>, N>;     // key: "layout.Calendar"
  };
}

type CalendarMode = "month" | "week";

interface CalendarEntry<N> {
  readonly id: string;                                      // the record id
  readonly content: N;                                      // title and detail fields, built by the renderer
  readonly label: string;                                   // plain-text accessible name: title, details, colour text
  readonly color?: { readonly slot: number; readonly label: string };  // slot 0..7
  readonly movable: boolean;                                // editable and not pending
  readonly pending: boolean;                                // a move is in flight
}

interface CalendarDayProps<N> {
  readonly date: string;                                    // "YYYY-MM-DD"
  readonly dayOfMonth: number;
  readonly weekday: number;                                 // 0 = Sunday
  readonly label: string;                                   // "Thursday 15 October 2026"
  readonly inMonth: boolean;                                // always true in week mode
  readonly isToday: boolean;
  readonly entries: readonly CalendarEntry<N>[];            // all of the day's entries, in sort order
}

interface CalendarProps<N> {
  readonly label: string;                                   // accessible name of the whole calendar (the view title)
  readonly title: string;                                   // the period heading: "October 2026"
  readonly mode: CalendarMode;
  readonly modes: readonly { readonly mode: CalendarMode; readonly label: string }[];  // length 1: no switcher
  readonly weekdays: readonly { readonly short: string; readonly long: string }[];    // 7, in weekStartsOn order
  readonly days: readonly CalendarDayProps<N>[];            // 42 (month) or 7 (week), in order, rows of 7
  readonly legend: readonly { readonly slot: number; readonly label: string }[];
  readonly loading: boolean;                                // entries are being fetched; days are still given
  readonly notice?: N;                                      // e.g. the over-cap message; shown above the grid, announced politely
  readonly announcement?: { readonly seq: number; readonly text: string };  // for the component's live region
  readonly onModeChange: (mode: CalendarMode) => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onToday: () => void;
  readonly onOpenEntry?: (recordId: string) => void;        // set only when the view has a rowAction
  readonly onMove?: (recordId: string, date: string) => void;  // set only when the view is editable
}
```

`ErrorSummary`, the load-error "Retry" `Button` and the over-cap notice (as `notice`) are rendered by the renderer, not the component. `onMove` accepts any real `"YYYY-MM-DD"`, not only visible days; the renderer ignores a dropped day equal to the current one and handles everything else per "Moving an entry". `announcement.seq` increases on every message so an identical message is announced again. Strings the renderer composes (titles, notices, announcements) are English, like every other engine message; button text inside the component (Previous, Next, Today, Move to day…) belongs to the component, which derives names such as "Previous month" from `mode`.

**Compatibility: the key is optional in slice 1.** Registries that exist today (the published base set and every host's own) have no calendar component. A required key would make every one of them fail to type-check and force a lock-step release of this repo, the components repo and every host, for a view kind most documents will not use. With an optional key, nothing changes for existing registries and documents; a calendar document with a registry that lacks the key renders an `ErrorSummary` ("This registry has no layout.Calendar component, so the calendar view <id> cannot be shown.", code `required`, path `/layout/Calendar`) instead of crashing or showing nothing. `@yadad/testing`'s mock registry supplies a calendar, and the contract kit tests it. The key becomes required in the next major release after the base set ships it; until then `describe-registry` marks it optional so agents know.

### Component requirements (components repo)

The renderer owns data, range, optimistic state and announcements. The component owns drawing and all drag code (no drag code in the renderer, per the architecture); a pointer-drag library may be used there (components repo only). Required of the component:

- **Layout by container width, not viewport**, so it works in a narrow dashboard cell: wide enough shows the month or week **grid**; narrow shows an **agenda** (a list of days with their entries, day headings, empty days omitted in month mode, today always present). Same props either way. Switching mode and navigation are available in both.
- **Grid semantics:** `role="grid"` with column headers from `weekdays` and `gridcell`s named by the day `label`; one tab stop with a roving focus; arrow keys move by a day or a week, Home/End go to the row's first/last day, PageUp/PageDown call `onPrevious`/`onNext`; the current day's entries are in the Tab sequence and other days' are not. Today has `aria-current="date"` and visible "Today" text (not colour alone); out-of-month days stay readable (contrast at least 4.5:1) and their `label` is complete.
- **Entries** are buttons (or links) named by `label`; Enter and Space call `onOpenEntry` when set. A day with more entries than fit shows a "+N more" control that expands them in place; every entry stays reachable.
- **Moving:** every `movable` entry has a **"Move to day…"** action, always in the DOM and focusable (not shown only on hover), at least 24 by 24 CSS px, that opens a labelled date input defaulting to the entry's day and calls `onMove(id, date)` on confirm; Escape cancels and focus returns to the entry. This is the keyboard, touch and screen-reader path and is required whenever `onMove` is set. In agenda mode it is the only move path.
- **Drag** (grid mode, pointer): a movement threshold of about 4 px before a drag starts so a click still opens; touch drags start after a long press so scrolling still works; the target day is highlighted; Escape or dropping outside the grid cancels; dropping calls `onMove(id, date)` exactly once. Pending entries are not draggable. Respect `prefers-reduced-motion`. Keyboard drag (Space, arrows, Space) is optional.
- **Live region:** a `role="status"` `aria-live="polite"` element, always mounted, that shows `announcement.text`; the grid is `aria-busy` while `loading`. Pick-up and drop outcomes are announced through `announcement` (from the renderer), never invented in the component.
- Targets, focus rings and forced-colors/high-contrast support as in the rest of the base set; an axe test in the components repo for the grid and the agenda.

### Dashboards

The existing `view` widget embeds a calendar like it embeds a table: `{ "widget": "view", "view": "tasks_calendar" }`. The validator accepts calendar ids there (above). The calendar renders in the cell with the cell's size, so the component's container-width layout is what makes a small cell usable; the editor suggests at least 6 columns by 8 rows but does not enforce it. A calendar `rowAction` inside a cell replaces the cell's contents with Back, as for tables (RFC 0003). `count` and `stat` widgets work from a table view; a host that wants "tasks due this week" as a number uses a table view with the same filter and a relative-date range (`daysFromToday`), which already exists. Calendars can use relative dates in their own `filter` like any condition (resolved before the adapter call, D22). The view range itself is chosen by the viewer, never by the document, so nothing in the document needs a "visible range" condition.

### Renderer

`renderer` adds a calendar renderer used for a calendar document on its own and inside a dashboard `view` widget. It holds the state: mode, anchor, loaded records by range, pending moves, the live announcement sequence. It calls the runtime functions above, builds entries with the field `Display` components, and passes `CalendarProps` to `registry.layout.Calendar`. It never imports a component and contains no drag code. Tests use the mock registry (hard rule on test imports, D20): range load query, navigation, over-cap notice, optimistic move, revert on 400/403/409 with reload, missing-key `ErrorSummary`, rowAction opening and Back, embedded in a dashboard.

### Editor

A calendar panel in `editor`, emitting JSON Patch like the table panel. Scope for slice 1:

- "New calendar view" in the blank-view creator: pick an entity that has at least one date field; `dateField` defaults to the first date field, `titleField` is left to its default.
- Pickers: `dateField` (date fields only), `titleField` (text or select), `colorField` (select or reference, or none), `detailFields` (up to 3, any field except the date and title fields, with the existing reorder buttons).
- `modes`: month and week toggles (at least one stays on) plus a control for which is the default (move it first); `weekStartsOn` select; `editable` checkbox.
- `filter`: the existing condition builder; `sort`: the table's sort editor; `rowAction`: the table's Row action section (target pickers, bindings), reused as is.
- The dashboard editor's `view` widget picker lists calendar views.
- Every picker is generated from the same lists the validator uses (no hard-coded copy); invalid combinations are not offered. No live preview of the grid in slice 1.

### Documents, runtime and renderer fit the hard rules

- No component names or file paths: `layout.Calendar` is a registry key; a view id is an id.
- No escape hatches: a closed shape, no string expressions, no props bag, no index signatures; colour slots are numbers.
- Documents are the contract: behavior (which field places an entry, what a move changes) is in the document; the component never special-cases it.
- Dependency direction: types and validation in `core`; range math, queries and move planning in `runtime` (no `react`); state in `renderer`; drag in the components repo.

## Alternatives considered

- **A table grouped by date.** Needs no engine change but has no month geometry and no drag to another day, which is the point.
- **A generic "board" view with date buckets** (calendar and kanban as one view with a `groupBy`). The move semantics (change one field to the bucket's value) are the same, and a kanban view may later reuse `moveDay`'s shape. But a generalisation now would hide the real differences (range paging, week geometry, navigation) behind options; two small closed views are easier to validate than one open one.
- **Bundling a calendar library in the engine** (a full calendar widget). It would bring its own data model, event types and styling into `renderer`, against "documents are the contract" and the rule that third-party UI lives in the components repo. A components-repo implementation may still use a drag library inside the component.
- **Drag code in the renderer.** The renderer must stay free of specific components and of drag/resize (architecture §3); keyboard and touch would also have to be redone per registry. The engine therefore only defines `onMove`.
- **A `datetime` or timezone-aware field now.** There is no such field type; adding one touches every package and every adapter. Calendar dates need none of it, and a timezone-free `date` is the honest meaning of "due on the 15th".
- **A new `DataAdapter.range` method or protocol endpoint.** `find` with `gte`/`lte` already does it on every adapter and the HTTP protocol, and the range filter stays visible as an ordinary `Condition`.
- **Load everything and filter on the client.** Unbounded for a growing table; the range query bounds it.
- **`modes` including `day` and `agenda`.** A day view is just a one-column week and can come later; the phone agenda is a rendering of the same range, chosen by container width, not by the document.
- **Making `layout.Calendar` required.** See the compatibility paragraph.
- **A `mode` per viewer saved in the document.** The viewer's mode and period are runtime state; the document only sets the default and the allowed set.

## Phasing

**Slice 1** (the cards that follow this RFC):

1. `core`: `calendar` view kind, validation and error rows above, `describeContract`, `specVersion` 3 and `migrate()`, fixtures, registry types (`CalendarProps`, optional `layout.Calendar`).
2. `runtime`: `calendar.ts` (range math, `calendarQuery`, `loadCalendarRange`, `groupByDay`, `moveDay`, `colorSlot`), an adapter conformance case for empty dates, unit tests.
3. `renderer` and `testing`: the calendar renderer, the dashboard `view` widget, the mock registry's calendar and contract-kit tests.
4. `showcase`: a calendar view in the demo set, with a dashboard tab embedding it.
5. `editor`: the calendar panel.
6. Components repo: the `layout.Calendar` component (month/week grid, phone agenda, keyboard grid and "Move to day…", drag).

**Slice 2:** an "undated" tray (records whose `dateField` is empty, listed by `empty(dateField)`, draggable onto a day; a `showUndated` property), a `day` mode, `quickFilters` on calendars, a host hook for the visible range and period (deep links), click-an-empty-day to create (with the date prefilled), count/stat widgets over a calendar's range.

**Later, each its own `specVersion` step:** multi-day spans (`endField`, entries drawn across days, drag to move and resize), a `time` field type with `timeField` (time-of-day placement, week time grid, drag changes the time), recurrence (probably never; recurrence belongs on the server).

Where I would stop: one `date` field places an entry on one day; the only edit is moving it; no time, spans or recurrence.

## Decision (2026-10-15)

Accepted. The owner accepted the direction; the design calls were made while writing it, and these are the ones to check:

1. Calendar dates only (the `date` type); no time zone handling, no time of day.
2. The month grid is always six weeks (42 days) with real leading and trailing days.
3. One `find` per range, 500 per page, capped at 2,000 with a visible notice; undated records are excluded.
4. A move is `update(..., { [dateField]: day }, { baseVersion })`, optimistic, reverted and reloaded on any failure, with no client-side permission checks.
5. `layout.Calendar` is optional in slice 1; a missing component gives an `ErrorSummary`.
6. Drag is the component's; "Move to day…" (any date) is the required non-drag path.
7. `rowAction` is reused unchanged; a calendar can start a chain, never be a target.

## Open questions for the owner

1. Is a fixed six-week month acceptable, or should a month show only the weeks it needs (4 to 6 rows)?
2. Should `layout.Calendar` become required in the next major release, or stay optional for good (calendars as an opt-in extension)?
3. Is the cap of 2,000 entries per range right, or should very busy hosts be able to raise it (a view property)?
4. Is hiding entries that are moved out of the visible range (with an announcement) enough, or should "Move to day…" be limited to visible days?

### Answers (2026-10-15)

1. Fixed six weeks. A stable grid height matters more than saving a row, especially inside dashboard cells.
2. `layout.Calendar` stays optional until the reference component set ships a calendar, then becomes required in the next minor release (0.x minors may break), so a registry can't silently lack it.
3. 2,000 stays a runtime constant, not a view property. Revisit with a host hook for the visible range (slice 2) if a host needs more.
4. "Move to day…" accepts any date, as written: hiding the moved entry and announcing where it went is enough.

## Notes from the core implementation (2026-10-15)

Calls made where this RFC was silent; none changes the design.

- Ids in `dateField`, `titleField`, `colorField` and `detailFields` are checked like every other id: a non-string is `type`, a malformed id is `invalid-value`.
- A duplicate `detailFields` entry is `invalid-value` (as the table says), not `duplicate-id`. `sort` duplicates stay `duplicate-id`, as on tables.
- "The same field as `titleField`" for a detail field means the effective title: the explicit `titleField`, or the default (the entity's first text field) when it is omitted.
- `titleField: required` carries `allowed` (the entity's text and select fields) so an agent can pick one.
- A `rowAction` chain that starts at a calendar counts the calendar's own hop, so a calendar plus three table hops is the longest allowed; a longer one is `invalid-value` at `/rowAction/open` of the calendar. A calendar named as a `rowAction` target is the same `invalid-value` as a form.
- `count` and `stat` pointing at a calendar get a message that names the calendar; the code and path are unchanged.
- `describeContract()` gains `calendar` (modes, defaults, limits, allowed field types) and `optionalRegistryKeys` (`layout.Calendar`), which `pnpm describe-registry` prints.
- Adding `calendar` to `ViewDocument` forced a calendar case in the editor's field-reference lookup (so a field a calendar uses cannot be removed) and a placeholder in the showcase; the real editor panel and showcase view stay with their own cards.
