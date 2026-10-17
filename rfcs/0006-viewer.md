# RFC 0006: Who is viewing

- Status: Accepted (2026-10-17); Slice 1 implemented (2026-10-17) — `core`, `runtime`, `renderer`/`testing`, `showcase` and `editor` are all done. Slice 2 is not started.
- Touches: `core` (a `viewer` document kind, one new condition op, new optional keys on existing views, `DataRecord.can`, validator, `describeContract`), `runtime` (viewer resolution, condition evaluation, view predicates, adapters, `viewStates` axes), `renderer` (every renderer takes `viewer`), `testing` (state checks), `editor` (viewer panel, condition builder), `docs/records-protocol.md`, `apps/showcase`. No registry change: components are not told about the viewer.
- Bumps `specVersion` from 4 to **5** (read `SPEC_VERSION`; if another step landed first, take the next number) with an identity `migrate()` step (additive) and a before/after fixture pair.

## Summary

A yadad screen is a function of its documents, its records and today's date. This RFC adds a fourth input: **facts about the viewer**, such as a role, a plan or a feature flag.

1. A new document kind, `viewer`, declares the facts (a select or a boolean each, with a closed list of values and a mandatory default).
2. One new condition op, `viewerIn`, reads a fact. The same condition language, no strings. It is allowed in a fixed list of places: form item `visibleWhen`/`requiredWhen`, table column `visibleWhen`/`editableWhen`, `editableWhen` on calendar and board, `rowAction.visibleWhen`, dashboard tab and widget `visibleWhen`.
3. Records may carry `can: { update?, delete? }` so a server can say what *this* viewer may do with *this* record (an owner-locked record). The renderers read it.
4. The host passes a resolved viewer (`viewer` prop) to every renderer. A missing viewer renders the facts' declared defaults.
5. Facts become axes of the state grid (`viewStates`), and "record locked" becomes a state, so differences between viewers are listed and checked like any other state.

The server stays the authority. Everything here controls what the screen **offers**; a refused write is still handled exactly as in RFCs 0004 and 0005 (revert, `ErrorSummary`, reload). Viewer facts are presentation input from the host, never a security boundary.

No registry key, component prop or field type is added in slice 1. No roles-to-permissions matrix, no per-field permissions, no form-level read-only mode (later slices).

## Motivation

- A viewer who may not edit still sees editable cells, drag handles and "Move to…", and learns otherwise from a 403. RFC 0005 says "no client-side permission checks", which is right about *guessing* but leaves the screen offering what will be refused.
- A record locked to its owner looks editable to everyone else.
- A host cannot show or hide a column, widget or tab by plan, role or flag without forking the documents.
- These differences are invisible to the state grid (`viewStates`), because the grid can only enumerate what the documents declare.

## Detailed design

### Viewer facts: the `viewer` document

A new document kind, `viewer`. A document set has **at most one**.

```jsonc
{
  "kind": "viewer", "specVersion": 5, "id": "viewer", "revision": 1,
  "facts": [
    { "id": "role", "label": "Role", "type": "select",
      "options": { "source": "static", "values": ["viewer", "editor", "owner"] },
      "default": "viewer" },
    { "id": "beta", "label": "Beta features", "type": "boolean", "default": false }
  ]
}
```

```ts
export const VIEWER_FACT_TYPES = ["select", "boolean"] as const;
export const VIEWER_FACTS_MAX = 8;
export const VIEWER_FACT_VALUES_MAX = 8;   // options of a select fact (minimum 2)

interface ViewerFactBase { readonly id: string; readonly label: string }
export interface SelectViewerFact extends ViewerFactBase {
  readonly type: "select";
  readonly options: StaticOptions;          // reused from select fields
  readonly default: string;                 // required; one of options.values
}
export interface BooleanViewerFact extends ViewerFactBase {
  readonly type: "boolean";
  readonly default: boolean;                // required
}
export type ViewerFact = SelectViewerFact | BooleanViewerFact;

export interface ViewerDocument {
  readonly kind: "viewer";
  readonly specVersion: SpecVersion;
  readonly id: string;
  readonly revision: number;
  readonly facts: readonly ViewerFact[];    // 1 to 8
}
export type ViewerFactValue = { readonly fact: string; readonly value: string | boolean };

/** Complete, valid viewer: every declared fact exactly once, in declaration order. */
export interface ResolvedViewer { readonly facts: readonly ViewerFactValue[] }
```

`DOCUMENT_KINDS` gains `"viewer"`; `Document` gains `ViewerDocument` (it is not a `ViewDocument`).

Why only select and boolean: both have a closed, known set of values, so the state grid can list every case and the editor can offer a picker. A free text or number fact (a user id, a quota) cannot be enumerated and invites "show this to user 42" documents, which belong on the server.

Why a mandatory `default`: it is the author's answer to "what should a viewer we know nothing about see?" and it is data that the grid and the editor show. See "Missing or unknown viewer".

### The host passes a resolved viewer

Every renderer (form, table, calendar, board, dashboard) takes an optional prop:

```ts
readonly viewer?: ResolvedViewer;
```

The host builds it with `resolveViewer` from `@yadad/runtime`:

```ts
resolveViewer(
  document: ViewerDocument | undefined,
  input?: readonly ViewerFactValue[],       // what the host knows, e.g. [{ fact: "role", value: "editor" }]
): { viewer: ResolvedViewer; issues: DocumentError[] };
```

Input is an array of `{ fact, value }`, not a `{ role: "editor" }` map: core has exactly one deliberate map (`RecordValues`, user data), and the second would be a new index signature (AGENTS.md rule 5). The array costs the host one line and is what the editor's "View as" produces anyway.

`resolveViewer` never throws. For each declared fact it takes the input value when valid and the declared `default` otherwise. `issues` reports what it had to ignore, in the document-error shape, with a JSON Pointer into `input`:

| Path | Code | When |
| --- | --- | --- |
| `/<i>/fact` | `unknown-reference` | the input names a fact the document does not declare (`allowed` lists the declared ids); the entry is ignored |
| `/<i>/fact` | `invalid-value` | a duplicate of an earlier entry; the first wins |
| `/<i>/value` | `type` | not a string for a select fact, not a boolean for a boolean fact; the default is used |
| `/<i>/value` | `invalid-value` | a select value not in `options.values` (`allowed` lists them); the default is used |

Renderers ignore `issues`; the host and tests can assert on them. With `document` undefined the result is `{ facts: [] }`.

Dashboards pass their `viewer` unchanged to every view they embed, and a `rowAction` passes it to the view it opens. A renderer that is mounted without a `viewer` follows the rule below.

### Missing or unknown viewer

The safe default is **the declared default of each fact**:

- **No `viewer` prop, and the renderer has the set** (a dashboard, table, calendar or board with `documents`): it resolves `resolveViewer(<the set's viewer document>, undefined)`, which is every fact at its default.
- **A value outside the declared list or of the wrong type** (a stale flag, a renamed role): that fact falls back to its default; the other facts are unaffected.
- **No `viewer` prop, no way to find the viewer document, and the view reads a viewer fact** (a bare `FormRenderer` with no `documents`): the renderer renders an `ErrorSummary` with code `required`, path `/viewer`, hint "Pass viewer={resolveViewer(viewerDocument, facts)}". This is a host programming error, in the same family as the missing registry key, not a state a user can reach, and guessing here would hide it. A view that reads no viewer fact never needs the prop: **documents that do not use viewer facts behave exactly as today.**
- **Evaluator level:** `evaluateCondition` with no viewer evaluates every `viewerIn` leaf to `false`. A valid document set cannot reach this (a leaf needs a declared fact, so a viewer document exists, so the renderers resolve one); it is only the total-function answer.

Why the declared default and not "deny" or "allow" built into the engine: only the author knows whether the least-privileged viewer is `viewer`, `guest` or `false`. A built-in "everything hidden" would blank the screen of a host that forgot a prop; a built-in "everything offered" would be today's behavior and silently defeat the document. The author-declared default is the least surprising and it is checked: the grid lists the "viewer not provided" state (below) and a test can assert it equals the default state. Because the server is the authority and affordances are hints, the worst outcome of a wrong default is today's behavior (an offered action that is refused).

### Conditions that read the viewer

One new leaf in the existing condition AST:

```ts
export type Condition =
  | /* ...existing ops... */
  /** The viewer's value for this fact is one of these. */
  | { readonly op: "viewerIn"; readonly fact: string; readonly values: readonly (string | boolean)[] };

/** The subset for places that have no record: viewerIn, and, or, not. */
export type ViewerCondition =
  | Extract<Condition, { readonly op: "viewerIn" }>
  | { readonly op: "and" | "or"; readonly conditions: readonly ViewerCondition[] }
  | { readonly op: "not"; readonly condition: ViewerCondition };
```

Examples: `{ "op": "viewerIn", "fact": "role", "values": ["editor", "owner"] }`; "everyone but viewers" is the same list or `{ "op": "not", ... }`; a boolean flag is `{ "op": "viewerIn", "fact": "beta", "values": [true] }`. One op (not `viewerIs` plus `viewerIn`) keeps the language small; `and`, `or`, `not` compose as they always do, and a form item can mix record and viewer leaves: `{ "op": "and", "conditions": [ { "op": "notEmpty", "field": "approver" }, { "op": "viewerIn", "fact": "role", "values": ["owner"] } ] }`.

`conditionFields(condition)` returns no field for a `viewerIn` leaf; a new `conditionViewerFacts(condition)` returns the fact ids. The existing depth limit (`MAX_CONDITION_DEPTH`) applies.

Evaluation in `runtime`:

```ts
evaluateCondition(condition: Condition, values: RecordValues, now?: Date, viewer?: ResolvedViewer): boolean;
evaluateViewerCondition(condition: ViewerCondition, viewer: ResolvedViewer): boolean;
```

Empty `and` is true and empty `or` is false, as before. A `viewerIn` leaf is true when the viewer's value for `fact` is in `values`, false when the fact is absent from `viewer`.

### Where a viewer condition may appear

| Place | Key | Accepts | Meaning |
| --- | --- | --- | --- |
| Form item | `visibleWhen`, `requiredWhen` | `Condition`: record leaves and viewer leaves | as today; a viewer leaf that is false hides the field exactly like a record condition |
| Table column | `visibleWhen` (new) | `ViewerCondition` | the column is not shown |
| Table column | `editableWhen` (new) | `ViewerCondition` | the column is editable in place only while true; needs `editable: true` |
| Calendar, board | `editableWhen` (new) | `ViewerCondition` | moving is offered only while true; needs `editable: true` |
| `rowAction` (table, calendar, board) | `visibleWhen` (new) | `ViewerCondition` | while false, rows/entries/cards do not open the target view |
| Dashboard tab | `visibleWhen` (new) | `ViewerCondition` | the tab is not listed |
| Dashboard grid item (any widget) | `visibleWhen` (new) | `ViewerCondition` | the widget is not rendered |

**Not allowed:** `filter` on table, calendar and board, the `filter` of `count` and `stat` widgets, `quickFilters`, `sort`. A filter is sent to the server as a query (`docs/records-protocol.md`); it cannot depend on a host-side fact the server did not authenticate, and a "who sees which records" rule belongs on the server (which already scopes `find` by user). A viewer leaf there is a validation error, not silently ignored.

**`editableWhen` is a separate key, not a union on `editable`.** `editable` stays a boolean, so existing documents, the editors' checkboxes and every reader of the type are unchanged. The effective rule is `editable === true && editableWhen holds (absent = holds) && record.can?.update !== false`. `editableWhen` can only tighten what `editable` allows, never grant it (the same "views may only tighten" principle as `requiredWhen`).

**Column-level, not table-level, `editableWhen`:** tables only have per-column `editable`, so the viewer condition sits next to it.

**Hidden is hidden, not disabled.** A forbidden control is removed, not greyed out: a removed control cannot be focused, announced or mistaken for a bug, and no registry prop is needed. A disabled control with a reason ("Only the owner can move this") is a later slice that needs registry props.

Behavior details:

- **Form:** a viewer-hidden item is not rendered, not validated and not submitted; a hidden item's stored value is kept, exactly like `visibleWhen` today. **`clearWhenHidden: true` is rejected on an item whose `visibleWhen` contains a viewer leaf**, because clearing would erase data the current viewer merely cannot see.
- **Table:** hidden columns are not passed to `layout.Table` and not loaded as cells. A `sort` or `quickFilters` entry that names a hidden column keeps working (they are about records, not about what is shown) but no sort indicator or filter control is shown for a column the viewer cannot see. If no column is visible the table shows a notice "There is nothing to show you here." instead of an empty grid.
- **Calendar and board:** when not editable for this viewer, `onMove` is not passed and every entry/card has `movable: false`, which is already the not-editable rendering; no drag handle and no "Move to…" action exist. The component needs no change.
- **rowAction:** while hidden, `onOpenRow`/`onOpenCard`/`onOpenEntry` is not passed; rows render as plain rows.
- **Dashboard:** a hidden item leaves its cell **empty; the grid does not reflow**, because positions are authored and reflowing would move content the author placed. A hidden tab is not listed; if the initially selected tab is hidden the first visible tab is selected; if no tab is visible the dashboard shows the notice "There is nothing to show you here."
- **No view-level `visibleWhen`:** a host decides which top-level view to mount; dashboards decide with item and tab conditions.

### Per-record permissions

Some refusals depend on the record: an owner-locked record, a list shared read-only. The viewer's facts cannot express that, so the **server tells the client per record**.

```ts
/** What the current viewer may do with one record. A missing key means "not stated: offered, the server decides". */
export interface RecordPermissions {
  readonly update?: boolean;
  readonly delete?: boolean;
}

export interface DataRecord {
  /* ...existing members... */
  /** Present only when the server states permissions. A hint for the UI, never sent back on writes. */
  readonly can?: RecordPermissions;
}
```

**Wire shape** (`docs/records-protocol.md`, the Record object gains one optional member):

```jsonc
{ "id": "t7", "entityId": "task", "entityRevision": 2, "version": "3",
  "values": { "title": "Pay rent", "list": "Todo" },
  "can": { "update": false } }
```

- It appears on every Record the server returns: list items, `GET`, `POST`/`PATCH`/batch responses, and the `current` record of a `409`.
- A missing `can`, or a missing key inside it, means "not stated". The client then offers the action, which is today's behavior; servers that do not implement this change nothing. (This is the opposite lean from a missing viewer, deliberately: a viewer default is chosen by the author, whereas the absence of a per-record statement is the absence of information, and hiding on no information would break every existing server.)
- `can` only restricts. `"update": true` does not enable an action the document does not offer. It is a read-time snapshot for the viewer making the request; it may change without `version` changing (a share was revoked), so clients never cache it across reloads and never send it back. The server still enforces: a refused write is a `403` and is handled as before.
- A request body never carries `can`. A server must ignore it if sent, not store it.
- `delete` is carried and enforced by the memory adapter in slice 1 although no renderer offers a delete yet, so servers state it once and future affordances (a table row delete) need no protocol change.

**Adapters** (`runtime`):

- **HTTP:** passes a valid `can` through. A malformed `can` (not an object, a non-boolean, an unknown key) is dropped, never an error: it is a hint.
- **Memory and key-value:** a new option `recordPermissions?: (record: DataRecord) => RecordPermissions | undefined`, applied at read time to every record they return. They also **enforce it**: `update` on a record whose permissions say `update: false` throws `ForbiddenError` (and `delete` likewise), so tests and the showcase get the true 403 path. The function is host code, not part of any document.
- `find` queries containing a `viewerIn` leaf throw `RecordValidationError` (`/filter`, `invalid-value`) in every adapter, so a viewer condition can never reach the wire.

**Renderers:** `canUpdate(record) = record.can?.update !== false`. A table row whose record cannot be updated shows `Display` instead of the inline `Editor` in editable columns; a calendar entry or board card gets `movable: false`; a drag or move is never started for it. Forms are create-only today, so `can` does not apply to them. After a successful write the returned record (with its new `can`) replaces the old one; after a failure the reload refreshes `can`.

### State grid

`viewStates` gets these axes, sharing `limit` and the pairwise cover:

- **One axis per viewer fact the view reads**, found by walking every `viewerIn` leaf in the view, the views it embeds and the views its row actions open. Facts nothing in the view reads are not axes (they would multiply states without changing the screen).
  - **select:** each value named in any leaf, plus one value no leaf names when the fact declares one (the "everyone else" class), so a 3-role fact read by one `["owner"]` leaf yields two states, not three.
  - **boolean:** true and false.
  - Unread facts take their default in every state.
- **A `permission` axis** (`unrestricted | record-locked`) on views that have an edit surface (an `editable` table column, calendar or board). In `record-locked` the first generated record carries `can: { update: false }` and the others do not, so one state shows a locked and an unlocked record side by side.
- **One extra state, "viewer not provided"**, when the set has a viewer document and the view reads a fact: it renders with `viewer` omitted and must equal the all-defaults state (a test, not a promise).

Each state gains `viewer: ResolvedViewer`, so `render(state, adapter)` and `checkViewStates` pass it through. Labels name the fact: "role = owner · 1 record locked". Views that read no viewer fact and have no edit surface produce exactly the states they produce today. `@yadad/testing`'s `checkViewStates` adds these problems, found by wrapping the registry to observe the props it receives (no component knowledge needed):

- a column, field, widget or tab is rendered that the state's viewer may not see, and the reverse;
- an editable affordance is offered (an inline `Editor`, `onMove`, `movable: true`, an open handler) in a state where the viewer condition is false or the record is locked, and the reverse;
- plus the existing checks.

### Validation and error codes

Same shape and codes as everywhere (`{ path, code, message, hint, allowed? }`, JSON Pointer paths). No new code. Shape checks run on a single document, referential checks in `validateDocuments`.

Viewer document, shape:

| Path | Code | When |
| --- | --- | --- |
| `/<key>` | `unknown-property` | any key other than `kind`, `specVersion`, `id`, `revision`, `facts` |
| `/id`, `/revision`, `/specVersion` | `required` / `type` / `invalid-value` | as for other documents |
| `/facts` | `required` / `type` | missing / not an array |
| `/facts` | `invalid-value` | empty, or more than 8 entries |
| `/facts/<i>` | `type` | not an object |
| `/facts/<i>/<key>` | `unknown-property` | any key other than `id`, `label`, `type`, `options`, `default` |
| `/facts/<i>/id` | `required` / `type` / `invalid-value` | missing / not a string / malformed id |
| `/facts/<i>/id` | `invalid-value` | a duplicate of an earlier fact |
| `/facts/<i>/label` | `required` / `type` | missing / not a string |
| `/facts/<i>/type` | `required` / `invalid-value` | missing / not `select` or `boolean` (`allowed`) |
| `/facts/<i>/options` | `required` | a `select` fact without it |
| `/facts/<i>/options` | `unknown-property` | a `boolean` fact with it (hint: remove `options`) |
| `/facts/<i>/options/values` | `invalid-value` | fewer than 2 or more than 8 values, or a blank value |
| `/facts/<i>/options/values/<j>` | `invalid-value` | a duplicate |
| `/facts/<i>/default` | `required` | missing (hint: "the value a viewer gets when the host says nothing; pick the least-privileged one") |
| `/facts/<i>/default` | `type` | not a string for a select, not a boolean for a boolean |
| `/facts/<i>/default` | `invalid-value` | not one of `options.values` (`allowed` lists them) |

Condition leaf, shape (wherever a `Condition` or `ViewerCondition` is validated; `<c>` is the leaf's path):

| Path | Code | When |
| --- | --- | --- |
| `<c>/op` | `invalid-value` | not a known op; `allowed` now includes `viewerIn` |
| `<c>/fact` | `required` / `type` / `invalid-value` | missing / not a string / malformed id |
| `<c>/values` | `required` / `type` | missing / not an array |
| `<c>/values` | `invalid-value` | empty or more than 8 entries |
| `<c>/values/<j>` | `type` | not a string or boolean |
| `<c>/values/<j>` | `invalid-value` | a duplicate |
| `<c>/field`, `<c>/value`, `<c>/conditions` | `unknown-property` | on a `viewerIn` leaf |

Placement (shape, because it is structural):

| Path | Code | When |
| --- | --- | --- |
| `<leaf>` inside `/filter`, a `count`/`stat` `/filter` | `invalid-value` | a `viewerIn` leaf. Message "A filter cannot depend on the viewer." Hint "Filters are sent to the server. Scope records on the server, or hide this view with a viewer condition." |
| `<leaf>` inside a viewer-only place (`/columns/<i>/visibleWhen`, `/columns/<i>/editableWhen`, `/editableWhen`, `/rowAction/visibleWhen`, `/tabs/<t>/visibleWhen`, `/tabs/<t>/items/<i>/visibleWhen`) | `invalid-value` | a record leaf (`eq`, `in`, `empty`, ...). Message "Only viewer conditions are allowed here." Hint "Use op viewerIn, optionally inside and, or, not." |
| `/columns/<i>/editableWhen`, `/editableWhen` | `invalid-value` | present while `editable` is not `true` (column-level for tables). Hint "editableWhen only narrows editable: true. Set editable to true or remove editableWhen." |
| `/sections/<s>/items/<i>/clearWhenHidden` | `invalid-value` | `true` while `visibleWhen` contains a viewer leaf. Hint "Clearing would erase a value the viewer cannot see. Remove clearWhenHidden." |

Referential (`validateDocuments`):

| Path | Code | When |
| --- | --- | --- |
| `<leaf>/fact` | `unknown-reference` | no such fact; `allowed` lists the declared ids. With no viewer document in the set the message is "No viewer document declares viewer facts." and the hint "Add a document of kind viewer." |
| `<leaf>/values/<j>` | `type` | a string for a boolean fact, a boolean for a select fact |
| `<leaf>/values/<j>` | `invalid-value` | a select value that is not in the fact's `options.values` (`allowed`) |
| `""` (of the second viewer document, `document` set) | `invalid-value` | more than one viewer document in the set. Hint "A set has one viewer document. Merge the facts." |

Warning (code `empty`, never blocks): `/facts/<i>` on a fact no document in the set reads ("Nothing reads this fact.", hint "Use it in a viewerIn condition or remove it.").

`describeContract()` lists the `viewer` kind with its properties and limits, the fact types, the `viewerIn` op with its exact shape, and a `conditionPlaces` list (path pattern, what it accepts: `record+viewer`, `viewer` or `record`) for every row of the placement table, so an agent can read where a viewer condition is allowed; `pnpm describe-registry` prints it. `optionalRegistryKeys` is unchanged.

### Versioning

`SPEC_VERSION` 4 to 5. `migrate()`: 4 to 5 stamps `specVersion: 5` (identity otherwise); versions 0 to 4 stay valid and, with no `viewer` document and no new keys, behave exactly as today. The validator does not gate the new keys on `specVersion`, as for the calendar and board kinds. Fixtures:

- before/after pair `migrate/` (a spec 4 set and its spec 5 stamp);
- valid: `viewer-minimal` (one boolean fact, one condition), `viewer-full` (a select and a boolean fact, a viewer leaf in every allowed place listed above, mixed record and viewer conditions on a form item, and a set with `can`-based records in a data fixture);
- invalid, one per row of each table above (every shape, placement and referential row, the duplicate viewer document, the unread-fact warning).

`Condition` gains a member, so downstream code that switches exhaustively on `op` or reads `condition.field` in a default branch needs a case. The core changeset says so. The change to `DataRecord` is additive and optional.

### Runtime helpers (pure, no React)

All unit-tested without a DOM, in a new `viewer.ts`:

```ts
resolveViewer(document, input?): { viewer: ResolvedViewer; issues: DocumentError[] };
findViewerDocument(documents: Iterable<Document>): ViewerDocument | undefined;
evaluateViewerCondition(condition: ViewerCondition, viewer: ResolvedViewer): boolean;
visibleColumns(view: TableView, viewer: ResolvedViewer): TableColumn[];
columnEditable(column: TableColumn, viewer: ResolvedViewer): boolean;
viewEditable(view: CalendarView | BoardView, viewer: ResolvedViewer): boolean;
rowActionVisible(action: RowAction, viewer: ResolvedViewer): boolean;
visibleTabs(view: DashboardView, viewer: ResolvedViewer): DashboardTab[];
visibleItems(tab: DashboardTab, viewer: ResolvedViewer): GridItem[];
canUpdate(record: DataRecord): boolean;
viewerFactsRead(view: ViewDocument, documents: Iterable<Document>): string[];   // for the state axes
```

`evaluateFormRules(view, values, viewer?)` and `applyFormRules` take the viewer and pass it to `evaluateCondition`.

### Renderer

Every renderer gains the optional `viewer?: ResolvedViewer` prop and uses the helpers above; dashboards and row actions pass it down. The registry, `layout.Table`, `layout.Calendar`, `layout.Board`, `layout.Tabs` and the field components are unchanged: they already receive only what is visible, and `onMove`, `movable` and the cell content already say what is editable. 403 handling is untouched.

### Editor

A viewer panel (the document is edited like any other document, as JSON Patch with undo): add, remove and reorder facts, edit labels, choose the type, edit a select's values, pick the default. A fact's `id` is fixed once created, as for field ids; removing a fact or a value that a condition still references is refused with the list of references (the validator would reject it). The condition builder gains a "Viewer" source next to "Field" in the places that accept it, with only the facts and values the set declares; the places that accept only a viewer condition show only that source. The table, calendar, board and dashboard panels get the `visibleWhen`/`editableWhen` controls (shown only where valid, and `editableWhen` only with `editable` checked). Conditions the builder cannot round-trip stay read-only with "Replace", as today. The states preview shows the viewer axes.

### Documents, runtime and renderer fit the hard rules

- Rule 1: the types, validation and the op are in `core` (no imports); evaluation and adapters in `runtime`; React only in `renderer` and `editor`.
- Rule 3: behavior changes through documents (`viewer`, `viewerIn`, `visibleWhen`, `editableWhen`); no component special-cases anything.
- Rule 4: no component names or paths; facts are ids.
- Rule 5: closed shapes, one fixed op, no string expressions, no props bag, no index signature (the viewer input is an array of typed entries).
- Rule 8: `specVersion` 5, `migrate()`, fixture pair, `describeContract`.

## Alternatives considered

- **Facts only as a host prop, no document.** Least work, but the state grid cannot enumerate them, the editor cannot offer them, validation cannot check `values`, and agents cannot read what exists. Rejected: the facts are the contract between host and documents.
- **Facts as a section of the entity.** Entities describe data; one viewer spans many entities, and the editor would need an entity open to declare it. Rejected.
- **Facts declared inside each view.** Duplication, drift between views, and nowhere to put the default. Rejected.
- **A map for the host input (`{ role: "editor" }`).** Nicer to type, but a second index signature in core's exports (rule 5). The array of `{ fact, value }` is the typed equivalent.
- **String expressions** (`"viewer.role == 'owner'"`). Forbidden by rule 5 and unvalidatable.
- **Reuse `eq`/`in` with a `viewer.role` field name.** Collides with entity field ids, makes every record condition ambiguous about where it reads, and cannot be restricted by place without parsing names. A separate op keeps the two namespaces apart in the AST.
- **A source key on `eq`** (`{ op: "eq", source: "viewer", field: ... }`). Changes the shape of every existing leaf for the sake of one new input.
- **Text and number facts.** Not enumerable; invites per-user documents. Rejected, may return as bucketed facts.
- **`editable` as `boolean | ViewerCondition`.** Breaks every reader of the boolean and the editors' checkboxes for no gain over `editableWhen`.
- **A roles-to-permissions matrix in a document** (`can: { owner: [...] }`). It is client-side authorization, copied and drifting from the server; RFC 0005's "no client-side permission checks" stands: the client acts on a fact the host states or a `can` the server states, and computes neither.
- **Viewer conditions in `filter`.** The server must scope records by the authenticated user; a client-supplied fact cannot be trusted for that, and the filter language is also the wire protocol.
- **Disable instead of hide.** Needs a registry prop and a reason string per affordance; hiding needs nothing and cannot confuse assistive technology. Disable-with-reason is a later slice.
- **Reflow the dashboard grid around hidden items.** Moves content the author placed. Rejected; gaps are the author's to fix with layout.
- **A separate permissions endpoint** (`GET /{entity}/{id}/_can`). N+1 requests per list. A member on the Record costs nothing when absent.
- **Default "deny" or "allow" for a missing viewer.** See "Missing or unknown viewer": only the author knows the right default.
- **Errors for an unknown viewer value.** The host's roles can change before the documents do; blanking the screen over a stale flag is worse than the default. `issues` reports it to whoever cares.

## Phasing

**Slice 1** (the work that follows this RFC):

1. `core`: `viewer` kind and `ViewerDocument` types, constants, validation (every row above), the `viewerIn` op and `ViewerCondition`, the new optional keys (`TableColumn.visibleWhen`/`editableWhen`, `CalendarView.editableWhen`, `BoardView.editableWhen`, `RowAction.visibleWhen`, `DashboardTab.visibleWhen`, grid item `visibleWhen`), `RecordPermissions` and `DataRecord.can`, `describeContract` (kind, op, `conditionPlaces`), `specVersion` 5 and `migrate()`, fixtures including the exact expected errors of every invalid case, `ResolvedViewer` and `ViewerFactValue` types. `recordJsonSchema` is unchanged (`can` is not a value).
2. `runtime`: `viewer.ts` (all helpers above), `evaluateCondition` and form rules with a viewer, `can` in the HTTP adapter, `recordPermissions` in the memory and key-value adapters (carried and enforced), the guard against `viewerIn` in queries, the `docs/records-protocol.md` section with the example above, and `viewStates` (fact axes, `permission` axis, "viewer not provided").
3. `renderer` and `testing`: the `viewer` prop on form, table, calendar, board and dashboard renderers with the pass-through, hidden columns/fields/tabs/widgets, hidden `onMove`/open handlers, locked records, the `/viewer` `ErrorSummary`, 403 still reverting; `checkViewStates` with the viewer checks (registry wrapper); mock registry and contract kit need no new props.
4. `showcase`: a task list with roles, a plan flag, owner-locked records on the memory adapter, a "View as" control feeding `resolveViewer`, the grid showing the viewer axes, and one move the adapter refuses anyway.
5. `editor`: the viewer panel, the condition builder's Viewer source, `visibleWhen`/`editableWhen` controls, viewer axes in the states preview.

Nothing in the components repo changes.

**Slice 2:** form-level `submitWhen` and item `readOnlyWhen`; `visibleWhen` on board `groupBy` entries, `cardFields` and calendar `detailFields`; disabled-with-reason affordances (`lockedReason` on `BoardCard`, entries and cells); `can.create` per entity and a protocol way to state it; delete affordances that read `can.delete`; a dashboard option to reflow around hidden items; viewer-driven defaults for new records.

**Later, each its own `specVersion` step:** non-enumerable facts as bucketed values (a plan tier from a number), per-field permissions, a documented signed viewer token for hosts that want the server and client to share one source.

Where I would stop: a closed list of select/boolean facts with author-chosen defaults, one op, seven named places, a per-record `can` that only restricts, hide-not-disable, and the server still the only authority.

## Decision (2026-10-17)

Accepted. The owner pre-accepted the direction; the design calls were made while writing and these are the ones to check:

1. Facts live in a new `viewer` document kind, at most one per set; each fact is a `select` (2 to 8 values) or `boolean`, with a required `default`.
2. The host passes `viewer?: ResolvedViewer` to every renderer, built by `resolveViewer(document, input)`; input is an array of `{ fact, value }`, never a map. Invalid or unknown input falls back to the fact's default and is reported in `issues`, not rendered.
3. A missing viewer renders the declared defaults. A bare renderer that cannot find the viewer document but reads a fact shows an `ErrorSummary` (`required`, `/viewer`); documents without viewer facts are unaffected.
4. One new condition op, `viewerIn`, in the existing language; allowed in form item `visibleWhen`/`requiredWhen` (mixed with record leaves) and, as viewer-only `ViewerCondition`s, in table column `visibleWhen`/`editableWhen`, calendar/board `editableWhen`, `rowAction.visibleWhen`, dashboard tab and item `visibleWhen`. Rejected in every `filter`.
5. `editableWhen` is a separate key that can only tighten `editable: true`; `clearWhenHidden` is rejected with a viewer `visibleWhen`.
6. Per-record permissions are in slice 1: optional `can: { update?, delete? }` on the Record, a restriction only, missing means offered. The memory and key-value adapters take `recordPermissions` and enforce it with a real `ForbiddenError`.
7. Forbidden controls are removed, not disabled; hidden dashboard items leave a gap; no registry or component change.
8. The state grid gets one axis per viewer fact the view actually reads (select values reduced to named values plus one "everyone else"), a `permission` axis, and a "viewer not provided" state.
9. `specVersion` 4 to 5, identity `migrate()`, no per-version gating of the new keys.

## Open questions for the owner

1. Is the array form of the viewer input acceptable, or should core allow a second deliberate map next to `RecordValues` for `viewer={{ role: "editor" }}`?
2. Should a bare renderer with no viewer and no `documents` fail loudly (as written) or render with all viewer leaves false?
3. Should hidden dashboard items reflow in slice 1 instead of leaving a gap?
