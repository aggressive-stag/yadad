# Architecture

Authoritative architecture for the schema-driven UI engine. If another document disagrees with this one, this one wins. Agents: read this file and `AGENTS.md` before every task.

## 1. What this is

A runtime, schema-driven React engine for "glorified spreadsheet" apps: record tables, calendars, boards, user-defined dynamic forms, and rearrangeable tabs and dashboards, shown differently to different viewers. Data models and layouts are JSON documents stored in a database. A renderer turns those documents plus live records into working pages, with no redeploy.

Three requirements drive every decision:

- **Portable.** Nothing home-specific or work-specific in the engine. Only the component set, theme and data adapter change between contexts.
- **AI-friendly.** Agents edit small, strictly validated JSON documents, not JSX. The schema is the contract.
- **Owned where it matters.** We own the schema, runtime, renderer, editor logic, styled components and tokens. The editor's drag and resize is hand-written and keyboard accessible; table virtualization and accessible-widget libraries are accepted dependencies, confined to the components repo (see §9).

Positioning: Puck is a visual page builder for content. This engine is for data-bound pages. Build-time use (JSON bundled with the app) is the degenerate case of runtime use.

## 2. Two repositories

| Repo | Contains | Depends on | Role |
| --- | --- | --- | --- |
| `yadad` (this repo) | Schema format, runtime, renderer, editor, theme, fixtures, test kit, showcase | React (renderer/editor only) | The open-source project. Gets the README, docs and polish. |
| `yadad-components` | Styled field, layout and widget components (including `layout.Calendar`, `layout.Board`, `layout.Dialog` and `layout.Pager`, and the optional `fields.datetime`), the base registry | `@yadad/core` as a peer dependency (a published version range); `@yadad/testing` as a dev dependency | Reference component set. Users can bring their own instead. |

The engine never imports from the components repo. Components implement the engine's contract and are handed to the engine through an injected registry. Separate repos make that boundary physical. The components repo is mirrored on the same GitLab instance and publishes to the same npm registry (D17).

## 3. Engine packages

The package list is fixed. Adding a package requires an RFC (`rfcs/NNNN-*.md`).

```
yadad/
  packages/
    core/       types, JSON Schemas, document validation, spec migrations,
                contracts (Registry, DataAdapter, Query, error format)
    runtime/    headless, no React: form state, condition evaluator,
                record validation, query model, JSON Patch apply,
                calendar and board logic, viewer resolution and predicates,
                viewStates (the state grid), memory / key-value / HTTP adapters
    renderer/   React: walks view documents, resolves registry keys, wires runtime state
    editor/     authoring: emits JSON Patch against entity/view docs; property panels
                from an exhaustive per-field-type map; hand-written drag/resize;
                viewer panel and rules; the states preview
    theme/      token names + token values + CSS-variable emitter
  testing/      contract test kit, mock registry, state adapter and
                checkViewStates (published)
  fixtures/     canonical valid/invalid docs and expected-error lists
  rfcs/         contract and package changes (reserved)
  apps/showcase/
  examples/     (reserved, empty)
  ARCHITECTURE.md  AGENTS.md  (+ AGENTS.md per package)
```

| Package | Owns | Must not know about |
| --- | --- | --- |
| core | Document shapes, validation, migrations, interfaces | React, components, themes, I/O |
| runtime | State and logic: forms, conditions, record validation, queries, patches, the data adapters | React, DOM, components |
| renderer | Turning documents + runtime state into React trees via registry keys | Specific components, the editor, drag/resize |
| editor | Producing JSON Patch operations against documents | Specific components (asks the registry) |
| theme | Token names and values, CSS variables | Everything else |
| testing | The mock registry, the registry contract kit, source states and `checkViewStates` | Renderers and editors (it imports `core` and `runtime`; their tests import it) |

Why `runtime` is separate: TanStack Table, Formily, JSON Forms, RJSF (`@rjsf/utils`) and React Stately all keep state and logic out of the view layer. It keeps `core` small and slow-moving, makes logic testable without a DOM, and lets the same record validation run server-side (a backend can validate against the same generated JSON Schema).

## 4. Dependency rules

```mermaid
flowchart BT
  core[core]
  runtime[runtime] --> core
  renderer[renderer] --> core
  renderer --> runtime
  editor[editor] --> core
  editor --> runtime
  testing[testing] --> core
  testing --> runtime
  theme[theme]
  showcase[apps/showcase] --> renderer
  showcase --> editor
  showcase --> theme
  showcase -. injects .-> reg
  subgraph comp["components repo"]
    reg[registry/base.ts] --> sets[sets/base/*]
    sets --> core
    sets --> theme
  end
```

Arrows mean "imports from".

- `core` imports nothing.
- `runtime` imports `core` only. No `react`.
- `renderer` and `editor` import `core` and `runtime` only. They never import a component; they look up registry keys.
- `theme` imports nothing.
- `testing` imports `core` and `runtime` only. It never imports `renderer` or `editor`, whose tests import it: `checkViewStates` takes the host's `render` function instead (D23).
- Nothing in `packages/` or `testing/` imports the components repo.
- No deep imports (`@yadad/core/src/...`); public entry points only. `testing` has three: the package index, `@yadad/testing/contract-kit` and `@yadad/testing/state-checks` (the last two need Vitest and a DOM, so the index stays free of them).
- Test files in any package may also import `@yadad/testing` (the mock registry); production files may not (D20).
- The host app (the showcase, or any host app) builds a `Registry` and a `DataAdapter` and passes them in via props or React context. This is the only place dependency injection is used.

CI enforces these with dependency-cruiser. A forbidden import fails the build.

## 5. Runtime model: two inputs, two writers

```mermaid
flowchart LR
  store[(Schema store<br/>entity + view docs)] -- documents --> R[renderer + runtime]
  data[(Data source<br/>records)] -- records via DataAdapter --> R
  reg[Registry] -- injected --> R
  viewer[Viewer facts<br/>resolveViewer] -- viewer prop --> R
  R --> page[Page: form / table / calendar / board / dashboard]
  page -- create/update records --> data
  editor[Editor] -- JSON Patch --> store
```

- **Two separate streams.** Documents describe shape. Records are content. They are joined by field `id`; neither contains the other.
- **Two separate writers.** The editor (and agents) write documents. Pages write records. No code path writes both.
- **Data access is injected.** Views name a `dataSource` key; the host maps keys to adapters, just as it maps field types to components. No API URLs in documents.
- **Who is viewing is a third, host-supplied input.** The host tells the renderers facts about the viewer (a role, a plan) and the documents say what those facts show or allow (§6). It narrows what is offered; it never replaces the server's checks.
- **Build-time** = pass a bundled document where a fetched one would go. Nothing else changes.

## 6. Document model: entities and views

An **entity** owns fields, types and validation. A **view** owns layout and references field ids. One entity can have many views.

```jsonc
// Entity: data model
{ "kind": "entity", "specVersion": 8, "id": "workout_set", "revision": 7,
  "fields": [
    { "id": "exercise", "type": "select", "label": "Exercise", "required": true,
      "options": { "source": "static", "values": ["Squat", "Bench"] } },
    { "id": "weight", "type": "number", "label": "Weight", "min": 0, "unit": "kg" } ] }

// Form view: layout only
{ "kind": "form", "specVersion": 8, "id": "log_set", "entity": "workout_set", "revision": 3,
  "dataSource": "default",
  "sections": [ { "id": "main", "title": "Set", "items": [
    { "field": "exercise" },
    { "field": "weight",
      "visibleWhen": { "op": "notEmpty", "field": "exercise" } } ] } ] }
```

Document kinds (`pnpm describe-registry` prints the exact shapes):

| Kind | What it is |
| --- | --- |
| `entity` | The data model: fields, types, validation |
| `form` | Sections of fields, with per-field `visibleWhen` and `requiredWhen` |
| `table` | Columns, initial sort, `pageSize`, a fixed `filter`, `quickFilters`, inline-edit flags, an optional `rowAction`, and the `recordActions` this view offers on each row |
| `calendar` | Records placed on the days of a month or week by one date field; optional editing moves an entry to another day (RFC 0004) |
| `board` | Records as cards in columns, one column per value of a select, boolean or reference field; the viewer picks among the `groupBy` fields; optional editing moves a card to another column (RFC 0005) |
| `dashboard` | Tabs of grid items `{x, y, w, h, widget}`; widgets: `view` (embeds a form, table, calendar or board), `count`, `stat`, `series` (a measure grouped by one field, shown as a table, bar chart or line chart through the optional `widgets.series` registry key — RFC 0001 slice 2, D48) |
| `viewer` | Not a view and draws nothing: the facts a host can tell the renderers about the viewer (RFC 0006). At most one per set |

The contract is still in flux (§11).

Rules:

- **Discriminated unions everywhere:** `kind` on documents, `type` on fields, `op` on conditions, `widget` on dashboard items. Each field type has its own typed `options` object (`select` has `options: { source: "static", values: string[] }` today; dynamic sources come later).
- **No escape hatches:** no index signatures, no `additionalProperties: true`, no free-form props bag, no `custom` field type taking arbitrary JSON, no string expressions.
- **Conditions are a JSON AST**, not strings. Ops: `eq, neq, gt, gte, lt, lte, in, contains, empty, notEmpty, and, or, not`, plus `viewerIn` (below). Types and validation in `core`; evaluation in `runtime`. A condition may only appear in the places `describeContract().conditionPlaces` lists (see "Who is viewing").
- **Hidden fields keep their values by default.** Opt in per item with `clearWhenHidden: true` (Form.io's `clearOnHide`).
- **Hide, don't disable.** What a viewer may not see or use is not rendered. Hidden form items keep their values by default; a hidden dashboard widget leaves its cell empty and the grid is not reflowed.
- **One source of truth:** the TypeScript types in `core` are the source of truth, and document validation is written against them by hand (`validateDocument`, `validateDocuments`). Generated standard JSON Schemas for each document shape — so backends and agents can read the contract — are the next step; nothing is hand-maintained in parallel.

### Who is viewing

A **viewer document** declares facts: each is a `select` (2 to 8 values) or a `boolean`, with a required `default` (pick the least-privileged one). The host builds the viewer for the current user with `resolveViewer(document, [{ fact, value }])` (an array, not a map: no index signatures) and passes the result as the `viewer` prop of any renderer. A value that is not valid for its fact falls back to the default and is listed in `issues`. With no `viewer` prop, a renderer that has the document set uses the declared defaults; a bare view that reads a fact and cannot find the viewer document shows an `ErrorSummary` at `/viewer`.

The `viewerIn` op (`{ "op": "viewerIn", "fact": "role", "values": ["editor", "owner"] }`) is true when the viewer's value of the fact is one of `values`. Where a condition may appear is part of the contract and `describeContract().conditionPlaces` lists it (path pattern, view kinds, what it accepts). In short:

| Place | Accepts | Effect while false |
| --- | --- | --- |
| form item `visibleWhen` and `requiredWhen` | record and viewer leaves, mixed | field hidden, or not required; `clearWhenHidden: true` is rejected when `visibleWhen` reads the viewer |
| table column `visibleWhen` | viewer leaves only (`ViewerCondition`) | column not shown |
| table column `editableWhen` | viewer only | column not editable in place |
| calendar and board `editableWhen` | viewer only | moving is not offered |
| `rowAction.visibleWhen` | viewer only | rows, entries and cards do not open the target |
| dashboard tab and grid item `visibleWhen` | viewer only | tab not listed, widget not rendered |
| any `filter` (including count and stat) | record leaves only | n/a: a filter is sent to the server as a query, so a `viewerIn` leaf is rejected |

`editableWhen` is a separate key that can only tighten `editable: true`; it never turns editing on.

**Per-record permissions** travel with the data, not the document. A record may carry `can: { update?, delete?, actions?, fields? }` (see `docs/records-protocol.md`). It states what the current viewer may do with that record and can only restrict: a missing `can` or key means "offered", and `true` enables nothing the document does not already offer. `actions` takes single record actions away by id (RFC 0007); `fields` is the per-writable-field map from RFC 0008 item 9 — a missing key or an absent map fails open, exactly like `can` itself. The renderers withhold in-place edit and "Move to…" on a record whose `can.update` is `false`, and an individual cell, checkbox or entry control when `can.fields` says its field is not writable. The server still decides: a refused write is a 403, the card or cell goes back and the record list reloads, which also refreshes `can`. The memory and key-value adapters take a `recordPermissions` option that states and enforces `can`, so a demo behaves like a server.

All of this narrows what is offered. It is not authorization: the server checks every write.

### Actions: the document through the registry dialog

An **action** is a command the entity declares and a view offers — approve, restore, close — a thing a record *does* rather than a value it holds, so it lives in neither the field list nor the layout.

- **Document** (`core`): an entity declares at most 12 `actions`, each `{ id, label, confirm?, input?, visibleWhen? }`. `confirm` is `{ message, title?, confirmLabel?, tone?: "neutral" | "danger" }`; `input` is 1 to 5 fields typed text, number, boolean, select, date, datetime or time — never `reference` or `tags`, because a record the viewer picked from another entity has no meaning to the server running the command, and a tag list is not a command parameter until the components chips widget ships (D49). `visibleWhen` mixes record and viewer leaves: the action is offered on a record only while it holds. A view (table, calendar or board) offers at most 6 of its entity's action ids by `recordActions`, in the order they appear on the row; a dashboard embedding the view inherits them. Caps and shapes live in `core` and print from `pnpm describe-registry`.
- **Runtime**: `availableActions(record, view, action...)` is the one answer to "may this row offer this action" — declared on the entity, offered by the view, `visibleWhen` holds for this record and viewer, and `can.actions[id]` does not say `false`. The renderer and the editor both call it, so an editor preview cannot drift from what the table draws. `actionNeedsDialog` says whether a press runs immediately or asks first: an action with `input` always asks, one with only `confirm` asks, a bare one runs.
- **Adapter**: `act(entity, id, action, request)` on `DataAdapter` (optional until the next major). A view whose adapter has none shows an error instead of buttons that would fail. The request carries the input values and the required `baseVersion`; the response is the record after the action (with its new `can`) or `null` when the action removed it. The HTTP adapter posts the protocol's actions endpoint; the memory and key-value adapters take an `actions` handler map and enforce the same order of refusals (`adapter-guards`). A refusal is a `ForbiddenError`, a stale or no-longer-applicable action a `RecordConflictError`, bad input a `RecordValidationError`.
- **Registry**: a dialog-requiring action renders through `layout.Dialog` — the component supplies only modal behaviour, the renderer supplies the title, message, confirm button and the input fields (drawn with the registry's own `Input`s). `Dialog` is optional like `layout.Calendar`: a view with such an action against a registry without it shows an `ErrorSummary` naming the missing key. Actions are never retried, and a row's button is `pending` until the response, so at most one is in flight per record.

### `datetime`

A field type holding an instant, stored in one string form so that comparing, sorting and paging never parse (`docs/records-protocol.md`, "Datetimes on the wire").

- **Engine** (`runtime/datetime.ts`): `formatDateTime` (Intl, locale and zone), `instantToLocal` / `localToInstant` (DST-safe — a local time that does not exist or occurs twice resolves to the earlier valid instant), and `instantRangeBounds` for the quick filter's from/to (from = start of its minute, to = last millisecond, so 10:00–10:30 includes 10:30:59.999). `core` validates the shape and gives `recordJsonSchema` its `format: "date-time"` plus pattern.
- **Renderer** formats for the viewer and hands the component both: the stored string for `<time dateTime>` and the formatted text in the Display's `text` extra. Renderers take an optional `formatting?: { locale?, timeZone? }`; absent, the environment's. A cell shows the viewer's wall-clock time, never the raw `...T18:22:07.123Z`.
- **Input** receives and returns the stored form; the component presents a native `datetime-local` or its own picker in the viewer's zone (the renderer converts at the boundary).
- **Registry**: `fields.datetime` is optional, like `layout.Calendar` — existing registries keep type-checking, and a document that uses the type against a registry without the key renders an `ErrorSummary` naming it. The reference components and the mock registry gained it in the same release as the type.
- **Editor**: the author panel and the compare/bound controls edit the canonical string; the panel reads a bare local time as UTC rather than the machine's zone, so a document says the same instant on every machine.
- Out of slice 1: relative values (`{ hoursFromNow }`), a calendar `dateField`, a board `groupBy`, and number/datetime `min`/`max` measures — all documented refusals, not omissions.

### `time` and `tags`

The two field types RFC 0008 added, each with a strict stored form, the way `datetime` has one.

- **`time`** holds a time of day, stored `"HH:MM"` — 24-hour, zero-padded, no day and no zone — with optional `min`/`max` bounds and a `step` in minutes. A time-only comparison compares minutes from midnight and takes `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `empty`, `notEmpty`. It is separate from `date` by design: a due date and a due time stay two fields, and a calendar entry is never placed by a time.
- **`tags`** holds `string[]` of non-empty strings in the order entered — the only field type whose value is an array. `contains` and `in` match ANY element (negate with `not`), `empty`/`notEmpty` work as usual. A tags field is never a sort key, a board `groupBy` or a series `groupBy`. Reads tolerate duplicates; the server may dedupe.
- **Registry**: unlike `fields.datetime`, both entries are *required* — the mapped type has no index signature, so a registry written before RFC 0008 does not type-check until it adds them. The reference set and `mockRegistry` shipped both in the same release.

### Compare

`compare` on a table column shows what changed in a text field: `{ "to": "previousRow" | "nextRow" }` diffs it against that neighbour in the table's own order, or `{ "field": "<other text field>" }` against another text field of the same record. The cell's value is the *after*; the comparator is the *before*. Text fields only, never together with `editable`.

- **Runtime** (`runtime/compare.ts`): `diffWords` produces the segments, `neighbourQuery` widens an offset page by one row so the first and last row of a page still have their neighbour (a cursor page cannot be widened backwards, so the table passes the previous page's last row as an explicit `edge`), and `compareCells` pairs each row with its comparator.
- **Renderer** hands the segments to the text Display's `diff` extra; the component marks them `<ins>`/`<del>` with hidden "added:"/"removed:" text.
- **Testing** keeps it honest: the state grid's `diff-missing` / `diff-offered` checks fail when a compared column with a neighbour shows no diff, or a column compared against nothing shows one.
- The editor builds and refuses the value in `setColumnCompare` (`editor/views.ts`): an editable column cannot compare (an edited cell has no meaningful diff), and only text columns may (a select is a value, not a text, and numbers have no words). The columns table's Compare control writes the same shape the runtime reads.

### The new state axes

The grid grew axis families past the condition and kind axes (§13): one `action:<id>` axis per offered action (`available`, `withheld on 1 record` — withheld sets `can.actions[id] = false` on the first generated record), a `paging` axis on tables (`pages by total`, `cursor page, more to come`, `cursor page, last`), and the `viewer:<fact>` and `permission` axes from RFC 0006. RFC 0008 added two more: a `done` axis on a calendar or board that sets `doneField` (the checkbox on and off), and a `columns` axis on a reference board with `columnsFrom: "options"` (one option holds no cards — the column exists with no drop target). The `time` and `tags` field types brought their value probes along (thresholds plus 23:59; empty/one/many/duplicate tags), and a `fieldEqFact` leaf seeds the compared field from the fact so a true-comparison state can render. `checkViewStates` gained the matching checks: `action-offered` / `action-missing` (nothing withheld may be offered, nothing allowed may hide), the pager checks, and the two diff checks above. `StatesPreview` (`editor`) names the action and paging axes on their own line — "States this view varies" — because they answer what the *product* varies, while the viewer axes answer what the viewer is told.

## 7. Validation: two kinds, one owner each

| | Document validation | Record validation |
| --- | --- | --- |
| Question | Is this entity/view well-formed? | Is this record valid for its entity? |
| Lives in | `core` | `runtime` |
| How | Shape per document, written in `core` against the TS types. Across a set, `validateDocuments`: referential checks (the view's entity exists, field ids exist on that entity, widgets point at existing views) | `validateRecord` in `runtime`, hand-written per field type (readable messages for forms). `recordJsonSchema(entity)` in `core` compiles the entity to standard JSON Schema (draft 2020-12), so a backend validates with any off-the-shelf validator; a parity test proves the two agree, and the few known differences are listed in `docs/records-protocol.md`. `pnpm record-schema <entity.json>` prints the schema |
| Constraints | n/a | `required`, `min`, `max` (and `step` for numbers) live on the entity. Views may only make rules stricter, never looser. |

Error format everywhere: `{ path, code, message, hint }`, where `path` is a JSON Pointer. Messages must be readable by a person and actionable by an agent. A set's errors also name the document they belong to (`DocumentError.document`) and, where a value must be one of a known set, the accepted alternatives (`DocumentError.allowed`).

Validation also returns `warnings` in the same shape (code `empty`): the document is valid, but probably not what the author meant, such as a form with no fields or a tab with no widgets. Warnings never block a document, so editors can pass through those states.

Referential checks span documents, so they run only when a set of documents is validated together (`validateDocuments`); a single document is checked for shape alone.

The contract itself is also machine-readable: `describeContract()` in `core` is a pure function that returns a plain JSON description of everything a document can contain (document kinds and their properties, field types and their type-specific properties, condition ops with their exact shapes, `conditionPlaces`, widget types, grid limits, the id pattern, the error codes). It is generated from the same constants the validator uses, so the description cannot drift from the validation. The root script `pnpm describe-registry` prints it (readable text by default, `--json` for machines) directly from the TypeScript source, so it works from a fresh clone without a build step.

## 8. Versioning: two different versions

| | `specVersion` (engine format) | `revision` (user document) |
| --- | --- | --- |
| Changes when | The engine's document language changes (an engine change) | Someone edits an entity or view |
| Migration | Pure `migrate(doc, from, to)` in `core`, plus a before/after fixture pair | None for additive edits. Destructive edits (delete a field, change its type) go through an explicit editor transform. |
| Records | n/a | Store `{ entityId, entityRevision }`. Old records are upcast lazily on read. If one fails validation, show "saved under revision N" instead of crashing. |

Documents use `specVersion: 8`; the validator also accepts the older versions 0 to 7, which `migrate()` stamps step by step. Each step so far was additive, so every older document stays valid: 1 added relative dates in conditions (D22), 2 the `stat` widget, `reference` field and `rowAction`, 3 the `calendar` view, 4 the `board` view, 5 the `viewer` document, the `viewerIn` op and the viewer-only keys, 6 the `datetime` field type, entity `actions`, view `recordActions`, the column `compare` setting and optional page totals (RFC 0007, D45), and 7 the `series` widget (RFC 0001 slice 2, D48), and 8 every accepted item of RFC 0008 and RFC 0009 plus the `time` and `tags` field types (D49). Any other value is rejected (no freeze is planned — §11). Each document's `revision` counts its own edits: bump it whenever you change that document. A view's revision is independent of its entity's, even when the numbers happen to match.

## 9. Registry contract and ownership

Exact-key lookup, no ranked testers.

```ts
interface FieldTypeEntry<K extends FieldType, N> {
  type: K;                        // "number"
  Input: Component<InputProps<FieldDefinitions[K], FieldValueTypes[K]>, N>;     // form control
  Display: Component<DisplayProps<FieldDefinitions[K], FieldValueTypes[K]>, N>; // table cell / read-only
}

interface Registry<N> {
  fields: { readonly [K in FieldType]: FieldTypeEntry<K, N> }; // mapped type, no index signature; `datetime` is optional until the reference set ships it (RFC 0007), like Calendar below; `time` and `tags` (RFC 0008) are required entries — registries written before them must add both
  layout: { FieldFrame; Section; Button; Table; ErrorSummary; Tabs; Panel;
            Calendar?; Board?; Dialog?; Pager? };              // optional keys: without Calendar/Board (or, for Dialog, an action needing a dialog) that view renders an error summary; without Pager, a table keeps the renderer's own Previous/Next markup
  widgets: { count: Component<CountWidgetProps, N> };         // "view" widgets render through the renderer itself; "stat" shows its number through "count"
}
```

Table inline editing reuses `Input` (there is no separate `CellEditor`), and the editor's property panels come from an exhaustive per-field-type map in the `editor` package rendered with the registry's own inputs (there is no `optionsSchema` yet). `describeContract()` and `pnpm describe-registry` (section 7) are the agent-facing catalog of the field types, options and widgets a document can use.

What we own vs depend on:

| Layer | Decision | Where |
| --- | --- | --- |
| Schema, runtime, renderer, editor logic, tokens | Own | engine |
| Styled components | Own; one `vN` folder per version side by side, `UPSTREAM.md` per component (the base set is written from scratch) | components repo |
| Accessible behavior primitives (Radix, React Aria or Base UI) | Accept as dependency when needed; the current base set is hand-written | components repo only |
| Table state and virtualization (TanStack Table / Virtual) | Accept as dependency when needed; not used yet — the base table renders all rows — and sort/filter semantics stay in documents + adapter | components repo only |
| Dashboard drag/resize | Own: hand-written over CSS grid — pointer drag and corner resize, arrow keys, each change announced | editor only |
| Field/section/column reordering | Own: hand-written buttons in the view editors | editor only |
| Dashboard rendering in view mode | Own: plain CSS grid from `x, y, w, h` with a fixed row height (`--yadad-grid-row-height`, 4rem default; D18) | renderer |

## 10. Data adapter

```ts
interface DataAdapter {
  find(entity: string, query: Query): Promise<Page<DataRecord>>;
  findOne(entity: string, id: string): Promise<DataRecord | null>;
  create(entity: string, values: RecordValues, meta: WriteMeta): Promise<DataRecord>;
  update(entity: string, id: string, patch: RecordValues, meta: WriteMeta): Promise<DataRecord>;
  delete(entity: string, id: string, meta?: WriteMeta): Promise<void>;
  batch(entity: string, ops: BatchOperations, meta: WriteMeta): Promise<BatchResult>;
  act?(entity: string, id: string, action: string, request: ActionRequest): Promise<DataRecord | null>; // RFC 0007; a view with recordActions and an adapter without it shows an error
}
// WriteMeta = { entityRevision: number; baseVersion?: string }
// Records carry an opaque `version`; writes send it back as `baseVersion`, and a stale one is a conflict.
// Query = { filter?: Condition, sort?: {field, dir}[], page?: {offset, limit} | {cursor, limit} }
// Page<T> = { items; total?: number; next?: string | null } — `next` is an opaque cursor (RFC 0007); the client passes it back untouched.
```

Interface, `Query` and the typed adapter errors in `core`. The memory, key-value and HTTP adapters in `runtime` all implement record versions and optimistic concurrency; the HTTP adapter (`createHttpAdapter`) speaks the records protocol in `docs/records-protocol.md` to a same-origin backend. A Supabase adapter can live here (depending on `core` only) or in the host app; none exists yet.

## 11. Stability policy

- Fixed package list; new packages and new dependencies need an RFC.
- The contract is in flux: `specVersion` is `8`, and no `contract-vN` freeze or tag is planned (D13). When the format does change, it ships with a `specVersion` bump, a `migrate()` step and a before/after fixture pair (AGENTS.md rule 8) — a future freeze is a separate decision, not a deadline.
- Agents land and release their own work (D14): changes to a published package carry a changeset; breaking changes carry a `BREAKING CHANGE:` note that says exactly what consumers must change. Consumers adopt the new version, and the components repo widens its peer range when a release falls outside it.
- Deprecations last at least one minor with a runtime warning.
- Public API reports and size budgets (size-limit) are the next CI gates (see `.github/workflows/ci.yml`).
- `core` reaches 1.0 when two real apps (the exit-criteria apps, D12) have run on an unchanged contract for several weeks.

## 12. Testing

1. **Fixture corpus** (`fixtures/`): valid documents for the field types and view kinds in use, and invalid documents — each with the exact expected errors asserted in `testing/`. This is also the spec.
2. **Contract test kit** (`testing/`): the components repo runs it against every registry entry. Checks: renders with fixture options, emits the right JSON type on change, shows a given error, passes axe.
3. **State checks** (`testing/`): `checkViewStates` renders every state of a view with the host's renderers and reports the broken ones (see "The state grid" below).
4. **Renderer tests against a mock registry** (stub components with `data-testid`). Engine CI never needs real components.
5. **Migration tests:** once a `specVersion` bump ships a migration, every historical fixture migrates to the current `specVersion` and validates.
6. **Runtime unit tests** for the condition evaluator and form state.
7. **Cross-language check:** a small pytest job validates the record fixtures against the generated JSON Schemas — planned, once the schemas exist.
8. **Visual checks:** the components repo has a vite gallery for manual browser checks, plus rerunnable Playwright checks (keyboard, phone touch) that drive it; screenshot comparison tests are not set up.

## 13. The state grid

A view is not one picture: a form hides fields, a table can be empty or full, a board can have a locked card, and a viewer with another role sees another page. The state grid lists those states from the documents instead of leaving them to be remembered, in four layers that each import only what the dependency rules allow:

```mermaid
flowchart LR
  docs[(documents)] --> vs["runtime: viewStates"]
  vs --> ss["testing: sourceStates"]
  ss --> chk["testing: checkViewStates"]
  vs --> grid["showcase: States page"]
  vs --> prev["editor: StatesPreview"]
  chk -. host passes checkStates .-> prev
  chk --> grid
```

1. **`viewStates(view, documents, { now, limit? })`** (`runtime`) is a pure function of the documents and `now`. It reads the view's conditions and kind and builds **axes**: each condition's field with boundary values by type, the view kind's own axes (a form's `fill`, the record count of a table, calendar or board, a calendar's `mode`, a board's `group`, a dashboard's `tab` and embedded views, a table's `paging` — RFC 0007), one `viewer:<fact>` axis per viewer fact the view reads, one `action:<id>` axis per action the view offers (RFC 0007), and a `permission` axis on views with an edit surface (`unrestricted` or `record-locked`, where the first record carries `can: { update: false }`). A **state** picks one value per axis and carries what to render: form values, or validated records and the ids matching the filter, a viewer, and `now`. When the full product fits in `limit` (24 by default) all combinations are listed; otherwise a deterministic pairwise cover keeps every pair of values from two axes in at least one state, and `complete` says whether even that fit. States that cannot exist are pruned (a locked record with no records, a dashboard tab the viewer cannot see). One extra state, `viewer-not-provided`, renders with no `viewer` prop to prove it looks like the all-defaults viewer.
2. **`sourceStates`** and **`createStateAdapter`** (`testing`) add the data source's states to those: loading, failed to load, a save refused (400 or 403) and a conflict (409), each only where it makes sense for the view. Each state gets a seeded adapter in that condition.
3. **`checkViewStates`** (`testing/state-checks`) renders every state through a `render` function the host passes in (`testing` never imports a renderer), and checks it: it must not throw or log a console error, forms must show and require exactly the fields the conditions say, every control needs an accessible name, a failed load must say so, and for the viewer axes nothing hidden may be shown and nothing the viewer may not use may be offered (`viewer-visibility`, `editable-offered`, `editable-missing`), and a board or calendar must use the grouping, mode and range the state names (`group-by-ignored`, `mode-ignored`, `anchor-ignored`), and RFC 0007's action and compare axes are checked the same way (`action-offered`, `action-missing`, `diff-missing`, `diff-offered`, §6).
4. **Consumers.** The showcase's States page renders the whole grid for any view with the checks beside it, and `StatesPreview` (`editor`) sits next to a view editor and marks states that are new or differ from the saved revision. The editor cannot import `testing`, so the host passes `renderState` and, optionally, `checkStates` as props.

The states are documents-in, pictures-out: adding a condition to a document changes its grid without anyone writing a test.
