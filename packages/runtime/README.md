# @yadad/runtime

Headless state and logic for yadad: form state and submission, condition evaluation, record validation, JSON Patch, drafts, and the `DataAdapter` implementations. No React, no DOM; it depends only on `@yadad/core`, so the same logic runs in tests or on a server.

```sh
npm install @yadad/runtime @yadad/core
```

## Data adapters

All three implement `DataAdapter` with record versions and optimistic concurrency: a write carries the `baseVersion` it read, and a stale one throws `RecordConflictError`.

```ts
import { createHttpAdapter, createKeyValueAdapter, createMemoryAdapter } from "@yadad/runtime";

const memory = createMemoryAdapter();                          // tests, demos; nothing persists
const local = createKeyValueAdapter(window.localStorage, "app"); // survives a reload
const http = createHttpAdapter({
  baseUrl: "/api/records",
  onUnauthorized: () => { window.location.href = "/sign-in"; },
});
```

`createHttpAdapter` speaks the [records protocol](../../docs/records-protocol.md) and nothing else. It sends cookies same-origin by default (`credentials`), takes extra `headers` and a custom `fetch`, and maps every non-2xx status to a typed error. `onUnauthorized` runs on any 401 (the call still rejects with `UnauthorizedError`). Pass `{ fields: { entity_id: ["field_id"] } }` to the memory and key-value adapters to reject writes that name unknown fields. Pass `recordPermissions: (record) => ({ update: false })` (or `undefined` for an unrestricted record) to have them state `can` on the records they return and refuse the write with a `ForbiddenError`, as a server's 403 would. The HTTP adapter passes a valid `can` through and drops a malformed one. Every adapter rejects a filter that contains a `viewerIn` leaf: filters go to the server.

A `find` answer may carry `next` without `total` — cursor paging, the client never parses the token. The memory adapter answers `total` and `next`; pass `{ paging: "cursor" }` to it (or the key-value adapter) to get only `next`, and test what a table does with a server that does not count. `can.actions` (`{ apply: false }`) takes single actions away; an adapter without `act` simply reports the action as unsupported where a view offers it.

### Running actions on a record

`act(entity, id, action, { input, meta })` (on `DataAdapter`, optional until the next major) runs one of the entity's declared actions; the HTTP adapter posts `.../actions/{action}` with the `baseVersion` it read, so a stale run is a `RecordConflictError` like any stale write, and it resolves to the record after the action — or `null` when the action removed it. The memory and key-value adapters run the actions you hand them via `options.actions` — each handler gets the record and the validated input and returns a patch of values, or `{ remove: true }`:

```ts
import { createMemoryAdapter } from "@yadad/runtime";

const adapter = createMemoryAdapter({
  actions: {
    apply: () => ({ values: { status: "applied" } }),
    reject: (_record, input) => ({ values: { status: "rejected", note: input.reason } }),
    restore: () => ({ remove: true }),
  },
});
```

## Datetimes

A `datetime` field stores exactly one string: `YYYY-MM-DDTHH:MM:SS.sssZ`. `isIsoDatetime` (in core) is the gate; everything here takes and returns that form:

```ts
import { formatDateTime, instantToLocal, localToInstant, instantRangeBounds } from "@yadad/runtime";

formatDateTime("2026-10-21T14:30:00.000Z", { locale: "en-US", timeZone: "America/Chicago" }); // display text, the viewer's zone
instantToLocal("2026-10-21T14:30:00.000Z", "Europe/Berlin");  // "2026-10-21T16:30" — a datetime-local picker's value
localToInstant("2026-10-21T16:30", "Europe/Berlin");          // back to the canonical instant (a DST-ambiguous time resolves earlier)
instantRangeBounds("2026-10-21T10:00", "2026-10-21T10:30", "America/Chicago"); // { from, to } for a quick filter: a range typed to 10:30 includes 10:30:59.999
```

`LOCAL_DATETIME_PATTERN` matches the `YYYY-MM-DDTHH:MM` a local picker shows. A bad zone, instant or local string throws `RangeError`.

## Actions and compare

- `availableActions(entity, view, record, viewer?)` is the one answer to "may this row offer this action": the view's `recordActions` order, kept only where the action exists, its `visibleWhen` holds for the record and viewer, and `can.actions` does not say false. The renderer and the state grid both call this, so they cannot disagree.
- `actionNeedsDialog(action)` (a `confirm` or any `input`) and `validateActionInput(action, input)` drive the confirm-and-input dialog; the input field types are the ones with a plain input — no `reference`.
- `diffWords(before, after)` is a word diff (`{ text, added? }` segments); `compareCells(rows, column, edge?)` runs it for a `compare` column across a page — against a neighbour row (widen the read with `neighbourQuery`, or pass the page outside your window as `edge` for cursor pages) or against another text field of each record. `neighbourQuery` widens an offset page by one row and leaves cursor queries alone; a cursor page's first row needs the previous page's last row as `edge`.

## Logic

- `evaluateCondition(condition, values, now?, viewer?)`, `evaluateFormRules(view, values, viewer?)` and `applyFormRules(entity, view, values, viewer?)`: visibility and required-ness. Hidden fields keep their values unless the item sets `clearWhenHidden`. Relative dates (`{ daysFromToday: n }`) resolve to local `"YYYY-MM-DD"` before evaluation and before any adapter call.
- `resolveViewer(viewerDocument, [{ fact, value }])` returns `{ viewer, issues }`: the `ResolvedViewer` the renderers take (every declared fact once, the host's value when valid and the declared default otherwise) and `issues` for what it ignored. `evaluateViewerCondition`, `visibleColumns`, `columnEditable`, `viewEditable`, `rowActionVisible`, `visibleTabs`, `visibleItems` and `canUpdate` answer what a viewer may see and do; `findViewerDocument` and `viewerFactsRead` find the facts a set declares and a view reads. A `viewerIn` leaf is false without a viewer.
- `validateRecord(entity, values)`: record validation against the entity's field rules.
- `submitForm(entity, values, adapter)` and `submitEdit(entity, record, patch, adapter)`: validate, then write.
- `applyPatch(doc, operations)`: JSON Patch against a document.

## Calendars and boards

The logic behind the calendar and board renderers is plain functions you can use or test without React:

```ts
import { boardColumns, boardQuery, moveCard, visibleDays } from "@yadad/runtime";

visibleDays("2026-10-17", "month", 1, "2026-10-17"); // anchor, mode, weekStartsOn, today: 42 days for a month, 7 for a week
const columns = boardColumns(statusField);    // one column per select option, or per boolean value; reference columns come from loadBoardTargets
const plan = moveCard(board, entity, statusField, record, columns[1]); // what to send when a card lands in another column
```

- **Calendar.** `visibleDays`, `visibleRange`, `shiftAnchor`, `calendarToday`, `periodTitle`, `weekdayLabels`, `dayLabel`; `rangeCondition`, `calendarQuery` and `loadCalendarRange` (pages through `find`, capped at `CALENDAR_MAX_RECORDS`); `groupByDay`, `moveDay` and `colorSlot`. Invalid dates or `weekStartsOn` throw `RangeError`.
- **Board.** `boardColumns`, `groupByColumn`, `boardColumnCounts`, `boardQuery`, `loadBoardCards` (capped at `BOARD_MAX_CARDS`), `loadBoardTargets` (reference columns) and `moveCard`.

## View states

`viewStates(view, documents, { now, limit })` lists the states a view can be in, read from its documents instead of guessed. It is a pure function of the view, the entities and views it needs, and `now`, so the same input always gives the same states in the same order. Use it to check a changed document in every state that matters, or to render a grid of them.

```ts
import { viewStates } from "@yadad/runtime";

const { states, skipped, axes } = viewStates(view, [entity, view], { now: new Date(), limit: 24 });
for (const state of states) console.log(state.id, state.label); // "status = done · due yesterday · 1 record"
```

Each state has a stable `id`, a readable `label`, `values` (the chosen value id per axis id) and `render`: what to render, discriminated on `kind`. A form gets its draft `values`; a table, calendar or board gets `records` (every one validates against the entity) and `matching`, the ids that pass the view's `filter`; a dashboard gets a tab and one state per embedded view. Every `render` carries `now`.

Axes come from the conditions the view uses. For each field they compare, the values tried are:

- select: each option, plus empty
- boolean: false and true, plus empty when the field is not required
- number: just below, at and just above each threshold (one `step`, or 1, or the last decimal place), plus empty
- date: the day before, the day of and the day after each threshold, with relative dates resolved against `now`, plus empty
- text: empty, filled, and the compared value for `eq`, `in` and `contains`
- reference: empty and set

The view kind adds axes: forms a `fill` axis (other fields empty or filled); tables, calendars and boards a `records` axis (none; one; one with every optional value empty; one with long text; many, which is one more than the page size or than the calendar's or board's cap); calendars a `mode` axis and records on the first and last visible day; boards a `group` axis with each `groupBy` field; dashboards a `tab` axis and one axis per embedded view. A view that offers actions adds one per action (`action:<id>`, values "available" and "withheld on 1 record" — the second carries `can.actions` false on the first record); a table adds a `paging` axis (pages by total, a cursor page with more to come, the last cursor page) so both paging styles get rendered in the grid. A `datetime` field's generated value is 09:30 on `now`'s day in `options.timeZone` (default "UTC"), which is what a datetime quick filter state compares against.

A view that reads viewer facts (a `viewerIn` leaf in it, in the views it embeds or in the views its row actions open) gets one axis per fact, `viewer:<factId>`: a select fact takes the values the conditions name plus one value none names (the default if it is unnamed), a boolean takes true and false. Facts nothing reads are not axes and take their default. A view with an edit surface (an editable table column, calendar or board, or a dashboard embedding one) gets a `permission` axis, `unrestricted` or `record-locked`; in the latter the first record carries `can: { update: false }`. Each state has a `viewer` (a `ResolvedViewer`), and a view that reads a fact gets one extra state, `viewer-not-provided`, with `omitViewer: true`: render it without the `viewer` prop and it must look like the state of all defaults. That state counts towards `limit`.

States that cannot exist are left out: a locked record when there are no records, and a dashboard tab for a viewer who cannot see it (a viewer who sees no tab gets one state, on the first tab). States are all combinations of the axes when they fit in `limit` (default 24), otherwise a deterministic pairwise cover: every pair of values from two axes appears in at least one state. `complete` is false when `limit` was too small even for that. A state that cannot be built (for example a record that would not validate) is left out and listed under `skipped` with a reason. `combineAxes(axes, limit)` is the generic combiner, exported for your own axes.

## Drafts

`createDraftStore(storage)` keeps unsaved form input so a reload or navigation does not lose it. `storage` is anything with `getItem`, `setItem` and `removeItem`, so `localStorage` works as-is. Entries live under `yadad:draft:<formViewId>:<recordId or "new">` (change the prefix with the second argument). Storage errors are swallowed; a draft never breaks a form.

```ts
import { createDraftStore } from "@yadad/runtime";
const drafts = createDraftStore(window.localStorage);
```

When a draft is loaded, `restoreDraft(entity, draft)` fits it to the entity as it is now: values for fields the entity no longer has are dropped (and listed in `droppedFields`), values the current schema rejects are kept but reported in `invalidFields` (the renderer seeds them into the form's errors, so the field frames invalid instead of the bad value restoring silently), `revisionChanged` says the entity revision moved since the draft was taken, and it returns `null` if nothing is left to restore. The renderer uses this for its `drafts` option.
