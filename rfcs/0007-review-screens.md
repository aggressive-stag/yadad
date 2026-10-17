# RFC 0007: Review screens

- Status: Accepted (2026-10-17). Slice 1 is not started.
- Touches: `core` (a `datetime` field type, entity `actions`, view `recordActions`, a table column `compare`, optional `Page.total`, cursor paging, `RecordPermissions.actions`, one optional registry key, validator, `describeContract`, `recordJsonSchema`), `runtime` (datetime helpers, word diff, `DataAdapter.act`, memory and HTTP adapters, `viewStates` axes), `renderer` (record actions on tables, boards and calendars, the confirm and input flow, compare columns, paging without a total), `testing` (mock registry, contract kit, state checks), `editor`, `apps/showcase`, `docs/records-protocol.md`, the components repo (a dialog, datetime input and display, row-action buttons, diff marks).
- Bumps `specVersion` from 5 to **6** (read `SPEC_VERSION`; if another step landed first, take the next number) with an identity `migrate()` step (additive) and a before/after fixture pair.

## Summary

A review screen is a list over **versioned records**: what was overwritten or deleted, by whom and when; each record's version history, with what changed between neighbouring versions; and a list of open **decisions** (proposals to approve or reject) that name the records they touch. The viewer can **act**: apply a proposal, reject it with an optional reason, restore an old version, each after a confirmation, and a stale or refused action is reported, not guessed away.

Yadad can already draw the lists as tables with quick filters and open a history through `rowAction`. Six things are missing. This RFC adds one small, closed answer to each:

1. **Record actions.** An entity declares named commands (`actions`: id, label, confirmation, optional typed input, a `visibleWhen` condition). Table, board and calendar views offer a subset (`recordActions`). The adapter gets one optional method, `act`; the protocol gets `POST {base}/{entity}/{id}/actions/{action}`. A refused action is a `403`, a stale one a `409`, as writes are today.
2. **`datetime`.** A new field type for an instant: stored as ISO-8601 UTC with milliseconds, shown in the viewer's time zone, with comparison, sort, a "from/to" quick filter and a form input.
3. **Comparing versions.** A table column may declare `compare`: the cell shows what changed in that text field against the previous (or next) row, or against another field of the same record. The engine computes a word diff in `runtime`; the text `Display` draws it.
4. **Paging without a total.** `total` becomes optional. A server that never counts returns an opaque `next` cursor; the table pages with Previous and Next and no page count.
5. **Read-only data.** Already expressible (a table with no editable columns and no form); this RFC adds nothing and documents the pattern.
6. **Nested data.** Records plus drill-down (RFCs 0002 and 0003) are enough for slice 1: a decision's named records are a join entity reached through `rowAction`. Structured evidence beside them needs a dashboard drill target, which is slice 2; slice 1 shows evidence as pre-joined text.

Everything controls what the screen **offers**. The server remains the only authority, and the viewer, `can` and conditions only narrow what is offered (RFC 0006).

No string expressions, no free-form props, no `custom` field type, no component names in documents.

## Motivation

A service that keeps versioned records (notes, settings, documents, proposals) needs an owner-facing screen to see what changed and to undo or approve things. It is the same shape in many products: an audit list, a history with diffs, an approvals queue. Today yadad stops at the list. The first screen to be moved onto yadad exists as a static page served by the backend it reviews, and its API is the concrete example this RFC was checked against (see the coverage table). The needs are general, so they belong in the library and not in that host.

What a host cannot do today:

- Run a command on a record. Editing a field is the only write, and "approve", "reject" and "restore" are not edits of one field: they carry a confirmation, sometimes a reason, and the server decides what changes.
- Show when something happened. `date` has no time of day, and RFC 0004 deferred an instant type. A review list is ordered by minutes, not days.
- Show what changed in a text between two versions.
- Page a list the server cannot count. The protocol requires `total` and offset paging.

## Detailed design

### Record actions

#### Declaring them: on the entity

```jsonc
// entity "decision"
"actions": [
  { "id": "apply", "label": "Apply",
    "confirm": { "message": "Apply this decision? It changes the records it names." },
    "visibleWhen": { "op": "eq", "field": "state", "value": "pending" } },
  { "id": "reject", "label": "Reject",
    "confirm": { "title": "Reject decision", "message": "Reject this decision?", "confirmLabel": "Reject", "tone": "danger" },
    "input": [ { "id": "reason", "type": "text", "label": "Reason (optional)" } ],
    "visibleWhen": { "op": "eq", "field": "state", "value": "pending" } }
]
```

```ts
interface RecordAction {
  readonly id: string;                        // id pattern; unique among the entity's actions; at most 12 actions
  readonly label: string;                     // the button text
  readonly confirm?: ActionConfirm;           // absent: runs on press, without a dialog (unless it has input)
  readonly input?: readonly ActionInputField[]; // at most 5
  readonly visibleWhen?: Condition;           // record leaves and viewerIn leaves, as a form item's visibleWhen
}
interface ActionConfirm { readonly title?: string; readonly message: string; readonly confirmLabel?: string; readonly tone?: "neutral" | "danger" }
```

- `ActionInputField` is a field definition of type `text`, `number`, `boolean`, `select`, `date` or `datetime`, with the same properties as the entity field of that type (`id`, `label`, `required`, `min`, `options`, ...). Not `reference` (a picker needs a target query; slice 2). Input ids are unique within the action.
- The entity is the place because an action is something the data model can do to a record, the protocol endpoint is per entity and the condition reads that entity's fields. A view then chooses which actions to offer.
- An action with `input` always shows a dialog (it needs somewhere to ask); with neither `confirm` nor `input` it runs on press. An action with `confirm` and no `input` shows a message and two buttons.

#### Offering them: on views

```jsonc
{ "kind": "table", "id": "pending_decisions", "entity": "decision", ...,
  "recordActions": ["apply", "reject"] }
```

`recordActions` is an optional array on `table`, `board` and `calendar` views: 1 to 6 action ids of the view's entity, each once, shown in this order. Forms are create-only today and do not offer actions (slice 2). A dashboard embeds views and so inherits theirs.

#### Availability: one condition, hide not disable

An action is offered on a record when **all** hold:

1. its `visibleWhen`, if any, is true for the record's values and the viewer (the `evaluateCondition` that forms already use, with `viewer` passed through, RFC 0006);
2. `record.can?.actions?.[id] !== false` (below);
3. the view is not read-only for this viewer by any other rule (none today).

Otherwise it is **not rendered**. That is RFC 0006's rule (forbidden controls are removed, not disabled) and an action is shown only when it is available. There is no `enabledWhen`: a disabled button with no reason is worse than none, and disabled-with-reason is slice 2 together with RFC 0006's `lockedReason`.

#### Per-record `can.actions`

`RecordPermissions` gains one optional member:

```ts
readonly actions?: Readonly<Record<string, boolean>>;   // action id -> allowed; only `false` restricts
```

This is the second deliberate map in `core` (after `RecordValues`): its keys are action ids chosen by users, and `core` cannot list them, the same reason `RecordValues` exists. A missing `can`, a missing `actions` or a missing key means "not stated: offered, the server decides". Like the other `can` keys it only restricts, is a read-time snapshot, is never sent back, and a malformed `actions` (not an object, a non-boolean value) is dropped as a whole by the HTTP adapter (a hint, never an error).

#### The protocol endpoint

```
POST {base}/{entity}/{id}/actions/{action}
{ "input": { "reason": "duplicate of s4" }, "entityRevision": 3, "baseVersion": "7" }

200 Record     the record acted on, after the action (with its new `can`)
204            the action removed the record
```

- `input` holds the declared input fields' values; absent or `{}` when there are none. The server validates it against its own rules and may be stricter. An unknown input id is a `400`, as for record values.
- `baseVersion` is **required**: the version the client last read for `{id}`. It is the guard. Stale is a `409` with `"current": Record | null`, exactly as for `PATCH`, and is checked before `input` (so a stale action with invalid input is a `409`).
- `entityRevision` is the schema stamp, with the same meaning as on writes.
- `{action}` is an action id, which has the id pattern, so it cannot collide with anything or need escaping.
- Statuses: `400` bad input (path `/input/<field>`), `401`, `403` not allowed (the viewer, or `can.actions` said so), `404` unknown entity, record or action, `409` stale **or** no longer applicable (the record is not in a state the action works on; the message says why and `current` is the record now). A client cannot tell these two `409`s apart and does not need to: both reload.
- **Guarding against more than the record's own change.** An action sometimes depends on other state (restore an old version only if the current version is still the one the viewer saw). The protocol already allows the answer: "several records may share a version if the server stores them together; a write to any of them changes all of their versions". A server that wants an action guarded by other state makes `version` cover it, for example every version row of a chain shares the version of the chain's head. No `context` parameter is added (see Alternatives).
- Actions are not retried by the client, and a client sends at most one at a time per record (the button is `pending` until the response).

#### `DataAdapter.act`

```ts
interface ActionRequest {
  readonly input?: RecordValues;
  readonly meta: WriteMeta;          // entityRevision and baseVersion (required here)
}
interface DataAdapter {
  /* ...existing members... */
  /** Runs a declared action on a record. Optional until the next major release. Null: the action removed the record. */
  act?(entity: string, id: string, action: string, request: ActionRequest): Promise<DataRecord | null>;
}
```

- **Optional**, like `layout.Calendar` was: a required method would break every host's own adapter at type-check time for a feature most documents do not use. A view with `recordActions` rendered with an adapter that has no `act` shows an `ErrorSummary` (`required`, path `/dataSource`, "The data source of view <id> cannot run actions."), instead of buttons that fail. `act` becomes required in the next major release.
- **HTTP adapter:** implements the endpoint above and maps statuses to the existing typed errors (`RecordValidationError`, `ForbiddenError`, `RecordConflictError`, `RecordNotFoundError`). A `204` returns `null`.
- **Memory and key-value adapters:** a new option `actions?: Readonly<Record<string, ActionHandler>>` (host or test code, like `recordPermissions`; not part of any document). A handler is `(record, input) => ActionOutcome` with `ActionOutcome = { values?: RecordValues } | { remove: true }`. The adapter checks, in the order the protocol says: unknown action (`RecordNotFoundError`), `baseVersion` (`RecordConflictError` with `current`), `can.actions[id] === false` or `can.update`-style rules (`ForbiddenError`), then runs the handler; it applies `values` as a patch with a fresh `version`, or removes the record, and returns the stored record with permissions applied. A handler may throw `RecordConflictError` for "no longer applicable". So tests and the showcase get the real 403 and 409 paths.
- Input is checked by the renderer before sending with the same rules as record values (`validateRecord` over the input fields), so an invalid reason never leaves the dialog; the server's `400` is still handled.

#### Where renderers offer them

| View | How |
| --- | --- |
| table | A last column of buttons (the header text "Actions"), one per available action, in the row. It does not trigger `rowAction`. |
| board | Buttons on the card, next to the "Move to..." path. |
| calendar | Buttons on the entry (in the entry's menu where the component has one). |
| form | Not in slice 1. |

The component receives plain data and callbacks and decides how to draw them (buttons, a menu):

```ts
interface RecordActionItem {
  readonly id: string;
  readonly label: string;
  readonly tone: "neutral" | "danger";
  readonly pending: boolean;          // this record has an action in flight; the component disables its buttons
  readonly onPress: () => void;
}
// additive and optional on existing props:
TableRow.actions?: readonly RecordActionItem[];        TableProps.actionsLabel?: string;
BoardCard.actions?: readonly RecordActionItem[];
CalendarEntry.actions?: readonly RecordActionItem[];
```

Old components ignore the new optional props and show no buttons; the contract kit tests the reference ones. The renderer never builds the buttons itself, as it does not build links for `rowAction`.

#### The confirm and input flow, and the one new registry key

```ts
interface DialogProps<N> {
  readonly label: string;                 // accessible name (the action's confirm title, or its label)
  readonly onClose: () => void;           // Escape, outside press, the close control
  readonly children: N;                   // built by the renderer: message, input fields (FieldFrame + the type's Input), ErrorSummary, Cancel and Confirm Buttons
}
interface Registry<N> { readonly layout: { /* ... */ readonly Dialog?: Component<DialogProps<N>, N> } }   // "layout.Dialog"
```

- This is the dialog RFC 0003's slice 2 planned for `mode: "dialog"`; this RFC introduces the key and RFC 0003 reuses it. The renderer owns the content so the component only provides the modal behaviour: focus trapped inside and returned to the pressed button on close, Escape closes, background inert, scrolls on a phone.
- **Optional**, like `Calendar` and `Board`: a view with `recordActions` whose action needs a dialog, rendered with a registry that lacks it, shows an `ErrorSummary` (`required`, `/layout/Dialog`). Actions with neither `confirm` nor `input` need no dialog.
- Flow: press, then the dialog opens with the message and fields; Confirm validates the input, calls `act`, shows `pending` (Confirm disabled, "Working..." announced), then:
  - **success:** the dialog closes, an announcement says "<label> done" (the calendar and board announcement mechanism), and the visible page reloads (an action can change other rows) with the returned record's `can`. Focus goes back to the row's first remaining control, else the table.
  - **400:** the dialog stays open; `/input/<id>` issues go to that field, others to the dialog's `ErrorSummary`.
  - **403:** the dialog closes, the view's `ErrorSummary` shows the server's message, the page reloads (which refreshes `can`, so the action disappears if it should).
  - **409 or 404:** as 403 (the message says "changed since you loaded it" or why). Nothing is merged or retried.
  - **any other failure:** the dialog stays open with the message so the viewer can retry.

### `datetime`

A new field type `datetime`: an instant.

- **Stored** as a string in exactly one form, `YYYY-MM-DDTHH:MM:SS.sssZ`: UTC, always three fractional digits, always `Z` (what `Date.prototype.toISOString` prints). One form means string order is time order, so every adapter, the in-memory sort and a SQL `ORDER BY` agree without parsing. A server holding finer precision truncates to milliseconds on the wire. An offset (`+02:00`), a missing `Z`, other precision or a calendar-invalid value is `invalid-value` with a hint that shows the form. `null` is empty.
- **Properties:** `min` and `max` (canonical instants), like `date`.
- **Displayed** in the viewer's time zone and locale: the renderer calls `formatDateTime(value, { locale, timeZone, style })` from `runtime` (built on `Intl.DateTimeFormat`, default style date and time to the minute) and gives the text to the `Display` with the stored value for a `<time dateTime>`. Renderers take an optional `formatting?: { locale?: string; timeZone?: string }` prop; absent, the environment's. `viewStates` takes `timeZone` in its options and defaults to `"UTC"`, so a state grid is the same on every machine.
- **Form input:** `Input` receives the stored value and an `onChange` of the stored form; the component uses a native `datetime-local` or its own picker and the renderer converts between the viewer's zone and UTC (`localToInstant`, `instantToLocal` in `runtime`, DST-safe: a local time that does not exist or occurs twice is resolved to the earlier valid instant and the Input shows what was chosen).
- **Conditions:** `eq neq gt gte lt lte in empty notEmpty`, with a canonical instant as the value. No `contains`. Relative values (`{ hoursFromNow }`) are slice 2 (`resolveRelativeDates` is date-only and a fixed filter needs "now" to be injectable; do them together).
- **Sort:** as for `date`. Empty sorts last in both directions.
- **Quick filter:** a from/to range like `date`. The inputs are in the viewer's zone; the renderer converts "from" to the instant at the start of that minute and "to" to the last millisecond of that minute, so a range typed as 10:00 to 10:30 includes 10:30:59.999.
- **Calendars and boards:** not in slice 1. `dateField` must be a `date` field (a `datetime` is `invalid-value` with the hint "use a date field; placing instants on local days is not supported yet"); `groupBy` cannot be a datetime. Placing instants on the viewer's local days needs time-zone range maths (RFC 0004 kept it out for that reason) and moves between days would have to keep the time of day; it is slice 2.
- **Measures:** `min` and `max` stay number and date in slice 1.
- **Record schema:** `recordJsonSchema` emits `type: "string"`, `format: "date-time"` and a `pattern` for the canonical form, with `min` and `max` as the date's do (as patterns are not ordered, an exact range check is stated in the field's `description` and `validateRecord`, exactly as the schema already documents for steps). The parity test covers it. `docs/records-protocol.md` says datetimes are canonical strings.
- **Registry:** `fields.datetime` (an `Input` and a `Display`) is an **optional** member of `fields`, like `layout.Calendar` and `layout.Board`. Existing registries keep type-checking. A document that uses a `datetime` field with a registry that lacks the key renders an `ErrorSummary` naming the missing key, as a calendar does without `layout.Calendar`. The reference components and the mock registry add it in the same release.
- **Migration:** additive. Older documents have no `datetime` field and are unaffected; the validator does not gate the type on `specVersion`.

### Comparing versions

A table column may ask for a diff of a text field.

```jsonc
"columns": [
  { "field": "version" }, { "field": "changed_at" }, { "field": "author" },
  { "field": "body", "compare": { "to": "previousRow" } }
]
// or, in a list of changes where one row carries both texts:
{ "field": "body_after", "compare": { "field": "body_before" } }
```

```ts
interface ColumnCompare {            // exactly one of the two members
  readonly to?: "previousRow" | "nextRow";   // the neighbour in the table's own order (its sort, including the viewer's)
  readonly field?: string;                   // another text field of the same record
}
```

- **Applies to** `text` fields only (a select is a value, not a text; numbers have no words). The `compare.field`, when used, is a `text` field of the same entity other than the column's.
- **Meaning.** The cell shows the column's value as the **after** and the comparator's value as the **before**. In a history sorted oldest first, `previousRow` is the previous version. In one sorted newest first, `nextRow` is. The author chooses; the engine does not guess from field names.
- **Neighbour at a page edge.** For `to`, the runtime loads one extra row beyond the page edge with the same filter and sort (offset minus one for `previousRow`, limit plus one for `nextRow`), so the first row of page two still has its neighbour. A row with no neighbour (the oldest version) shows plain text. A comparator that is empty counts as the empty string (everything is added).
- **The engine computes** `diffWords(before, after): DiffSegment[]` in `runtime/diff.ts`, pure and unit-tested: tokens are runs of non-space characters and runs of whitespace; a longest-common-subsequence over tokens; adjacent segments of one kind are merged. `DiffSegment = { kind: "same" | "added" | "removed"; text: string }`. Cost is bounded: over 2,000 tokens on either side, the diff falls back to one `removed` plus one `added` segment (never a hang). No dependency.
- **The registry draws.** The `text` field's `Display` props gain optional `diff?: readonly DiffSegment[]`. A component that uses it draws additions and removals with marks that do not rely on colour (`<ins>` and `<del>`, plus visually hidden "added:" and "removed:" text for screen readers). A component that ignores it shows the plain value, which is a safe degradation. `FieldDisplayExtras.text` was empty; this is its first member.
- **Why not a registry key `display.Diff`:** a required key breaks every registry for one column option; an optional prop on an existing component does not, and keeps text rendering in one place.
- **Validation:** `compare` on a non-text field, `compare.field` unknown or not text or equal to the column's field, both or neither of `to`/`field`, and a `compare` column that is also `editable` (an edited cell has no meaningful diff) are errors with pointers like `/columns/3/compare/field` and hints.

### Paging without a total

Many servers page by cursor and never count. `total` becomes optional and a continuation token is added.

- **`Page<T>`** becomes `{ items; total?: number; next?: string | null }`. `Query.page` becomes `{ offset; limit } | { cursor; limit }`. `next` is an opaque token (`null` or absent at the end) the client passes back as `cursor`; the client never parses it.
- **Protocol:** `GET {base}/{entity}?filter=&sort=&cursor=&limit=` is an alternative to `offset`; sending both is a `400`. The response is `{ "items": [], "total"?: n, "next"?: "..." | null }`. A server may return `total` (as today), `next` (cursor only), or both; a server that returns neither has no way to say "there is more" and its client treats the page as the last.
- **How the client chooses.** The first request has no cursor and offset 0. If the response has `total`, the client uses offset paging as now (page numbers, "page 2 of 7"). If it has `next` and no `total`, it uses cursors: the table keeps a stack of the cursors it visited, so Previous works without the server supporting backward cursors, and the pager shows "Page 2" with Previous and Next, no "of N". Changing the sort, a quick filter or the page size clears the stack.
- **Rejected for the table: "Load more".** Appending rows grows the DOM without bound, makes `nextRow` comparison and the page-edge neighbour load ambiguous, and changes where focus goes. Previous and Next keeps `TableProps` as it is.
- **Count and stat widgets.** `limit=0` is the count request and needs `total`. Without it, a `count` walks the pages up to the same 5,000-record cap the `stat` widget already has and shows the number read, or "5000+" in `text` when the cap was hit with more pending; a `stat` already pages and already reports partial.
- **Calendar and board** read ranges and capped sets; they use `next` to continue and stop at their caps as they do now. `Page.total` consumers (`aggregate`, the table, the dashboard) are updated; the type change is flagged in the core changeset.
- **Memory and key-value adapters** keep returning `total`; an option `paging: "cursor"` makes them behave like a counting-free server (no `total`, `next` as an encoded offset) so tests cover the path.
- **`recordJsonSchema` and `viewStates`:** a `paging` axis, below.

### Read-only entities and fields

Already expressible, so no new key:

- an entity whose records a screen never writes is one whose views have **no `editable` columns, no calendar or board `editable`, and no form**. Records then change only through `recordActions`.
- server-derived fields (a "state", an "is current" flag) are ordinary fields the screen never edits; `visibleWhen` on actions reads them.

An entity-level `readOnly: true` was considered and rejected for slice 1: nothing would enforce it (the server is the authority, and the memory adapter would need a mode), and it would be a second way to say what a missing `editable` already says. If hosts later want tools to refuse creating or editing such records (the editor, an importer), it is additive.

### Nested data

References plus drill-down are enough for the records a decision names; nothing new is added for them. A decision with three records and two evidence excerpts:

```jsonc
// entities
"decision":        { "fields": [ state (select pending/applied/rejected), kind (select), summary (text), confidence (number),
                                  created_at (datetime), decided_at (datetime), decided_by (text), evidence (text) ] }
"decision_record": { "fields": [ decision (reference -> decision), record (reference -> record), role (select) ] }   // 3 rows for this decision
"record":          { "fields": [ key (text), body (text), state (select), author (text) ] }
// views
"pending_decisions": table over decision, filter state = pending, sort created_at desc,
                     columns [kind, summary, confidence, created_at, evidence], recordActions [apply, reject],
                     rowAction { open: "decision_records", bind: [{ field: <the decision id>, to: "decision" }] }
"decision_records":  table over decision_record, columns [record (reference, shown by its display field), role]
```

- The two evidence excerpts are one `evidence` text the server joins (two paragraphs, each side cut to a length the server chooses). They are display text the viewer reads and never acts on; making them records of their own is only worth it when someone filters or sorts by them.
- `rowAction` opens one target. Showing the named records and structured evidence as two lists below the clicked decision needs a **dashboard drill target** (bindings applied to each table widget of a dashboard). RFC 0003 left it out because it is the parameterized-view problem. It stays out here: slice 2 may add it as `bind` entries with an optional `view` to scope each to one widget. The documented slice 1 pattern is the join entity plus the pre-joined text.
- Rejected: a `list` or `object` field type or a JSON blob field (escape hatches, and the registry cannot know how to render them, hard rule 5); inline child rows in a table cell (a second layout language); `include` or expand parameters on `find` (a nested query language).

### State grid

`viewStates` (RFC 0006's axes stay) gains:

- **One `action:<id>` axis per action the view offers**, with values `available | withheld`. `withheld` is realised by `can: { actions: { <id>: false } }` on the first generated record, as the `permission` axis does; where the action's `visibleWhen` reads viewer facts or record fields, those are covered by the viewer axes of RFC 0006 and the value axes the form states already use for `visibleWhen`, so the leaf that hides it is itself a state. Labels: "apply withheld on 1 record".
- **A `paging` axis** (`total | cursor-more | cursor-end`) on tables, so the pager without a count, and its last page, are states. `cursor-end` is the page with `next: null`.
- **A `datetime` value** in the generated records: a fixed instant relative to `options.now`, rendered in `options.timeZone` ("UTC" by default).
- A `compare` column adds no axis; the generated records already include one with an empty neighbour (the first row) and one with a text that differs.

`@yadad/testing`'s `checkViewStates` adds these problems, found by wrapping the registry to observe the props it receives:

- an action item (`TableRow.actions`, `BoardCard.actions`, `CalendarEntry.actions`) present for a record where it is `withheld` or its `visibleWhen` is false for the state's viewer, and the reverse;
- a table row with a `compare` column whose text `Display` got no `diff` while it has a neighbour, or got one when it has none;
- a table pager that shows a page count in a `cursor-*` state is **not** a props check; it is a renderer test (the component owns pager text only in the sense of `Button` labels), so it stays out of the state checks.

Dialog flows (invalid input, refused, stale) are not state-grid axes: a state is a rendering and these need a press. They are scenarios in the contract kit (press the action, answer the dialog, make the adapter refuse) that every registry must pass.

### Validation and error codes

Same shape and codes as everywhere (`{ path, code, message, hint, allowed? }`, JSON Pointer paths). No new code. Shape checks run on a single document; referential checks in `validateDocuments`.

| Check | Code | Path |
| --- | --- | --- |
| `actions` not an array, more than 12, an action with an unknown key | `type`, `invalid-value`, `unknown-property` | `/actions`, `/actions/1` |
| action `id` bad pattern or repeated | `invalid-value`, `duplicate-id` | `/actions/1/id` |
| `label` missing or empty; `confirm.message` missing or empty; `confirm.tone` not neutral or danger | `required`, `invalid-value` | `/actions/1/label`, `/actions/1/confirm/message` |
| `input` over 5 fields; a field of type `reference` or an unknown type | `invalid-value`, `unknown-field-type` | `/actions/1/input/2/type` |
| input field ids repeated, or field properties invalid for the type | `duplicate-id`, `invalid-value` | `/actions/1/input/1/id` |
| `visibleWhen` names a field the entity does not have, or a bad op/value for the field's type | `unknown-reference`, `invalid-value` | `/actions/1/visibleWhen/field` |
| `recordActions` empty, over 6, or repeats an id | `empty`, `invalid-value`, `duplicate-id` | `/recordActions` |
| `recordActions` id not an action of the view's entity | `unknown-reference` | `/recordActions/1` |
| `compare` shape, field type, unknown or same field, also `editable` | `invalid-value`, `unknown-reference` | `/columns/3/compare/field` |
| `datetime` value not canonical; `min` later than `max` | `invalid-value` | `/fields/2/min` |
| `calendar.dateField` or `board.groupBy` a datetime; a `contains` on a datetime | `invalid-value` | `/dateField` |
| a `viewerIn` leaf inside an action's `visibleWhen` naming a fact the viewer document lacks | `unknown-reference` | `/actions/1/visibleWhen/fact` |

Each has a one-line `hint` that shows the fix ("write 2026-10-17T09:30:00.000Z", "add the action to the entity first"). `describeContract` lists the field type, the entity `actions` key, the view `recordActions` key, the `compare` column key, and the new condition place `/actions/*/visibleWhen [entity] record+viewer`.

### Versioning

`SPEC_VERSION` 5 to 6. `migrate()`: 5 to 6 stamps `specVersion: 6` (identity otherwise); versions 0 to 5 stay valid and, with none of the new keys, behave exactly as today. The validator does not gate the new keys on `specVersion`, as for earlier steps. Fixtures:

- before/after pair `migrate/` (a spec 5 set and its spec 6 stamp);
- valid: `actions-minimal` (one confirm-only action offered by a table), `actions-full` (input of every allowed type, a danger confirm, `visibleWhen` mixing record and viewer leaves, offered by a table, a board and a calendar), `datetime-minimal`, `compare-history` (a history table with `previousRow` and one with `field`), `join-drilldown` (the nested-data sketch above);
- invalid, one per row of the table above, with the exact expected errors;
- data fixtures: a record page with `next` and no `total`, `can.actions` on records, an action `409` body.

The core changeset says exactly what changes: `fields.datetime` is a new optional registry key, `Page.total` is optional, `Query.page` is a union, `RecordPermissions` gains a member, `DataRecord` is otherwise unchanged. The runtime changeset says the same for `Page`.

### Runtime, renderer, editor

- **Runtime:** `datetime.ts` (`formatDateTime`, `localToInstant`, `instantToLocal`, `instantRangeBounds`, canonical check), `diff.ts` (`diffWords`), `compare.ts` (the neighbour load and `compareCells(rows, column)`), `actions.ts` (`availableActions(entity, view, record, viewer)`, `validateActionInput`, `ActionHandler` types), cursor paging in the HTTP, memory and key-value adapters, `act` in the HTTP, memory and key-value adapters, adapter conformance cases (datetime order and empties, `act` 403/409/204/400, cursor and no-total, `limit=0` with no total), the `viewStates` axes.
- **Renderer:** `recordActions` on table, board and calendar renderers with the dialog flow and announcements; `compare` columns; cursor pager; datetime display and quick filter; count widget without a total; `formatting` prop. The Display for a `datetime` cell gets `text` and `value`.
- **Editor:** the entity panel gains an Actions section (add, label, confirm, tone, input fields, visibleWhen through the existing condition builder); the table, board and calendar panels get "Offer actions" (a multi-select of the entity's actions, ordered); the table panel gets "Compare" per text column; the field panel knows `datetime`. Emits JSON Patch as usual.

## Fit with the hard rules

- **Dependency direction:** types and validation in `core`; helpers in `runtime`; renderers import both. Nothing imports the components repo.
- **Documents are the contract:** behaviour comes from `actions`, `recordActions`, `compare` and `datetime`, never from a component; the renderer never special-cases a view.
- **No component names or paths** in `core`, `runtime`, `renderer`, `editor`: one new registry key, `layout.Dialog`, and optional props on existing components.
- **No escape hatches:** no string expressions (`visibleWhen` is the one condition language), no props bag (an action's input is typed fields), no `custom` type, no `any`. The one new deliberate map, `can.actions`, is keyed by user-chosen ids for the same reason `RecordValues` is.
- **New field type** has its JSON Schema entry, registry entry, valid and invalid fixtures and a render test against the mock registry.
- **New runtime dependencies:** none (`Intl` and a small LCS).

## Alternatives considered

- **Actions as an update of one field** (a `PATCH` that sets `state = applied`). It is how a trivial approve would work, but then the server cannot take a reason, cannot fail with "not applicable", and restore is not a field change. A named command is what these systems expose.
- **Actions on views only.** The same action would be repeated on every view of the entity, the endpoint is per entity, and the condition reads the entity's fields. Entity declares, view offers.
- **Actions declared on the entity and offered everywhere automatically.** A board card that gets every action of the entity is noise; the view's `recordActions` is the author's choice.
- **`enabledWhen` (disabled buttons).** Disabled controls without a reason are an accessibility cost; RFC 0006 already chose to remove forbidden controls. A reason-giving disabled state is slice 2.
- **A `context` list on the action** (fields of the record sent along, so a restore can say "I saw head X"). It makes the client responsible for the server's concurrency model and adds a request member for one use. `version` covering the guard works inside the existing protocol.
- **A required `DataAdapter.act`.** Breaks every host adapter for a feature most documents will not use; optional, with a clear error, costs one line per host later.
- **An action as `POST {base}/{entity}/_action` with the record id in the body.** The path form makes each action its own resource, readable in logs and routable without parsing bodies; and ids never start with `_`, so `_action` would have been another reserved word.
- **A server that already has its own routes.** A host with an existing API (different paths and shapes) implements `DataAdapter` itself (it is a six-method interface plus `act`) instead of the HTTP protocol. The protocol is for backends that want zero adapter code; the review screens work with either.
- **`datetime` as epoch milliseconds (a number).** Unreadable in a database and in a request log, confusable with `number`, and loses the "this is a time" meaning in the editor.
- **`datetime` with an offset or any ISO form.** Strings of different shapes do not sort as time, so every adapter would need to parse to order; one canonical UTC form keeps ordering a string comparison.
- **A `timezone` property on the field.** The viewer's zone is a display fact, not data. An instant has none.
- **Reusing `date` with a time part.** `date` is "YYYY-MM-DD" in the calendar maths of RFC 0004; mixing breaks its equality and its range queries.
- **Diff computed in the component.** It would be re-implemented in every component set and could not be unit-tested once; the engine computes, the component draws.
- **A `history` view kind** (a dedicated version list with built-in diff). A table with `rowAction`, a sort and a `compare` column already is one, and the same `compare` serves a list of changes; a new kind would duplicate the table.
- **Character diff, or a diff library.** Words are what a reader of notes and settings sees; a library is a runtime dependency (hard rule 7).
- **Offset paging only, a fake total** (the server counts up to a cap). Counting is what the server is avoiding, and a capped total lies.
- **A `hasMore` boolean** instead of `next`. It lets "Next" work only with offsets, which these servers cannot take.
- **Inline nested rows, a `list` field, expand parameters.** See Nested data.
- **Entity `readOnly`.** See Read-only entities.

## Phasing

**Slice 1** (the work that follows this RFC), sized to one change per package, plus the components repo:

1. **`core`:** `datetime` type and its validation and record schema; entity `actions`, view `recordActions`, `ColumnCompare`; `RecordPermissions.actions`; optional `Page.total`, `Page.next`, cursor `Query.page`; `ActionRequest` and `DataAdapter.act`; the registry types (`fields.datetime`, `RecordActionItem` and the optional props, `DialogProps`, `layout.Dialog`, `FieldDisplayExtras.text`); `describeContract`; `specVersion` 6, `migrate()`; every fixture above with exact expected errors.
2. **`runtime`:** the helpers above, the adapters (`act`, cursor paging, `datetime`), `docs/records-protocol.md`, conformance cases, `viewStates` axes.
3. **`renderer` and `testing`:** the renderers, the dialog flow, mock registry (a dialog, datetime, row actions, diff), contract kit scenarios, `checkViewStates` checks.
4. **`showcase`:** a "review" example: a changes table with datetime and compare, a history with word diff, a pending-decisions table with apply and reject and restore, the memory adapter refusing one action (403) and making one stale (409), the cursor-only mode.
5. **`editor`:** the panels above.
6. **Components repo:** `layout.Dialog`, `fields.datetime` Input and Display, row-action buttons on `Table`, `Board` and `Calendar`, diff marks on the text `Display`.

**Slice 2:** a dashboard drill target (bindings scoped per widget); actions on forms; `enabledWhen` with a visible reason; entity-level `readOnly`; `reference` input fields in actions; relative instants (`hoursFromNow`) in conditions; `datetime` as a calendar `dateField` and `min`/`max` measures; an action that opens a view with its result; "Load more" as an option if a host asks; bulk actions on a selection.

**Later, each its own `specVersion` step:** a signed viewer token, per-field diff styles, a character diff.

Where I would stop: one command per record at a time, a dialog whose content the renderer owns, one canonical instant form, a diff that is words only, cursors that are opaque, and the server the only authority.

## Coverage of the worked example

The case: a review screen over versioned records with approve, reject and restore, described generically. The host's API is cursor-paged JSON with its own routes; it implements `DataAdapter` itself (see Alternatives).

| Screen or action | Covered by | Slice |
| --- | --- | --- |
| List of changes (overwritten or deleted), newest first | `table` over a change entity, sort on a `datetime` column descending | 1 |
| Who made the change, when | author `text`/`select` column; `datetime` shown in the viewer's zone | 1 |
| Filter by kind of change, author, namespace | `quickFilters` on select and text fields | 1 |
| "Since" a time | `datetime` range quick filter | 1 |
| Cross-author flag | `boolean` column and quick filter | 1 |
| Old and new text of a change, side by side | a row carrying both texts; `compare: { field }` on the new one | 1 |
| Open a record's history from a change | `rowAction` bound on the chain id (RFC 0003) to a history table | 1 |
| History with what changed between neighbouring versions | history table sorted by version, `compare: { to: "previousRow" }` and `diffWords` | 1 |
| Cursor-paged lists with no total | optional `total`, `next` cursor, Previous/Next pager | 1 |
| Counts on a dashboard without a total | `count` widget walking pages to the cap | 1 |
| List of open decisions with state, type and namespace filters | `table`, select `quickFilters` | 1 |
| A decision names several records | join entity of `reference`s, reached by `rowAction` | 1 |
| Evidence excerpts per decision | pre-joined `text` column; structured evidence rows need a dashboard drill target | 1 as text; structured form deferred to slice 2 |
| Apply a decision, after confirmation | `RecordAction` with `confirm`, `recordActions` on the table, `layout.Dialog` | 1 |
| Reject with an optional reason | the same, with an optional `text` input | 1 |
| Restore an old version, refused when it is the current one or the chain moved | `RecordAction` `restore`, `visibleWhen` on a server-derived "is current" field, `baseVersion` covering the chain head | 1 |
| Refused or stale action is reported and the list reloads | `403` and `409` handling in the flow, `can.actions` after reload | 1 |
| Already-decided decision offers no apply | `visibleWhen` on the state field (and the `409` if it races) | 1 |
| Screens never create or edit records in place | read-only pattern: no form, no editable columns | 1 |
| Acting identity, access and the cross-site header guard | the host's: the adapter's `headers` option, the server's own session | host |
| The service's own route shapes | the host's `DataAdapter` over its API; the protocol is optional | host |

**Verdict:** slice 1 covers the review screens. Two items are deliberately simpler in slice 1 than in the example: structured evidence is shown as pre-joined text (the dashboard drill target is slice 2), and a host with its own routes writes a small `DataAdapter` rather than relying on the HTTP protocol.

## Decision (2026-10-17)

Accepted. The owner pre-accepted the direction to keep the queue moving; the design calls were made while writing it, and these are the ones to check:

1. Actions are declared on the entity (`id`, `label`, optional `confirm`, optional typed `input`, `visibleWhen`) and offered by views through `recordActions` on tables, boards and calendars; forms are slice 2.
2. Hide, not disable: one `visibleWhen` (record and viewer leaves) plus `can.actions[id] === false`; no `enabledWhen`.
3. The protocol endpoint is `POST {base}/{entity}/{id}/actions/{action}` with `input`, `entityRevision` and a required `baseVersion`; `200 Record` or `204`; `403` and `409` as for writes. Guards over other state are done by making `version` cover it; no `context`.
4. `DataAdapter.act` is optional; a missing one gives an `ErrorSummary`. The memory and key-value adapters take an `actions` option.
5. One new optional registry key, `layout.Dialog` (shared with RFC 0003 slice 2); the renderer builds the dialog content.
6. `datetime`: one canonical stored form (UTC, milliseconds, `Z`), displayed in the viewer's zone, ordered as a string, with a range quick filter. Not a calendar or board field and no relative values in slice 1. It is an optional member of `fields`; a registry without it shows an `ErrorSummary` where a `datetime` field is used.
7. `compare` on a text column: against the previous or next row, or against another text field; the diff is computed in `runtime`, drawn through an optional `diff` prop on the text `Display`.
8. `total` is optional and `next` is an opaque cursor; the table pages with Previous and Next and no count; counts walk to the cap.
9. Read-only needs no new key. Nested data is join entities plus drill-down; evidence is pre-joined text in slice 1.
10. `specVersion` 5 to 6 with an identity `migrate()`.

## Owner answers

The owner leans toward **allowing** rather than forbidding: optional registry keys and optional adapter methods, with a clear error where something is missing, rather than requirements that break existing component sets or adapters.

1. **`layout.Dialog` and `act` stay optional.** There is no plan to make them required. This also applies to `fields.datetime` (see Registry above).
2. **A dashboard drill target in slice 1:** still open. It stays in slice 2 unless the pre-joined evidence text proves too limited.
3. **Millisecond UTC is fine** as the one canonical stored form.
4. **An action without `confirm` and without `input` is allowed.** A document asks for a confirmation when it wants one.
