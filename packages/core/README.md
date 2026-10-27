# @yadad/core

The yadad contract: document types, document validation, spec migrations, and the `Registry` and `DataAdapter` interfaces that hosts implement. Headless: no React, no I/O, no runtime dependencies on other yadad packages.

```sh
npm install @yadad/core
```

## Validate documents

Documents (entities; form, table, calendar, board and dashboard views; and the viewer) are plain JSON. Validate anything that did not come from your own code:

```ts
import { migrate, validateDocument, validateDocuments } from "@yadad/core";

const result = validateDocument(migrate(JSON.parse(json)));
if (result.ok) {
  result.value; // a typed Document: EntityDocument | FormView | TableView | CalendarView | BoardView | DashboardView | ViewerDocument
} else {
  for (const e of result.errors) console.log(e.path, e.code, e.message, e.hint);
}

validateDocuments([entity, form, table]); // also checks references between documents
```

Errors are `{ path, code, message, hint }`: `path` is a JSON Pointer, and the message and hint are written to be read by a person or an agent. Valid documents may still carry `warnings` (for example a form with no fields).

## A board and who is viewing

A board shows records as cards in columns, one per value of a select, boolean or reference field. A `viewer` document declares facts about whoever is looking, and a `viewerIn` condition uses them (RFC 0006):

```ts
import type { BoardView, ViewerDocument } from "@yadad/core";

const viewer: ViewerDocument = {
  kind: "viewer", specVersion: 10, id: "viewer", revision: 1,
  facts: [{ id: "role", label: "Role", type: "select", options: { source: "static", values: ["viewer", "editor"] }, default: "viewer" }],
};

const board: BoardView = {
  kind: "board", specVersion: 10, id: "task_board", entity: "task", revision: 1, dataSource: "default",
  groupBy: [{ field: "status" }, { field: "owner" }], // the viewer picks one; the first is the default
  titleField: "title",
  editable: true, // dragging a card to another column changes the grouping field...
  editableWhen: { op: "viewerIn", fact: "role", values: ["editor"] }, // ...but only for editors
};
```

Viewer conditions may appear only where `describeContract().conditionPlaces` lists them, and never in a `filter`. A record read through a `DataAdapter` may carry `can: { update?, delete?, actions?, fields? }` (`RecordPermissions`), which can only take rights away — `actions` per record action, `fields` per writable field (RFC 0008 item 9); the server still decides.

## A review screen in the contract

RFC 0007 adds the document pieces a review screen needs. An entity declares what a record can do; a view offers the actions; a `datetime` field stores one canonical instant; a `compare` column says what a text cell is shown against:

```ts
import type { EntityDocument, TableView } from "@yadad/core";

const change: EntityDocument = {
  kind: "entity", specVersion: 10, id: "change", revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "body", type: "text", label: "Body" },
    { id: "previous", type: "text", label: "Previous body" },
    { id: "status", type: "select", label: "Status", options: { source: "static", values: ["pending", "applied", "rejected"] }, required: true },
    { id: "due", type: "datetime", label: "Due" }, // "YYYY-MM-DDTHH:MM:SS.sssZ", exactly
  ],
  actions: [
    { id: "reject", label: "Reject",
      confirm: { title: "Reject change", message: "Reject \"title\"?", tone: "danger" },
      input: [{ id: "reason", type: "text", label: "Reason", required: true }],
      visibleWhen: { op: "eq", field: "status", value: "pending" } },
  ],
};

const history: TableView = {
  kind: "table", specVersion: 10, id: "change_history", entity: "change", revision: 1, dataSource: "default",
  columns: [
    { field: "title" },
    { field: "body", compare: { field: "previous" } }, // diffs this cell against another field of the record; { to: "previousRow" } is the other choice
  ],
  recordActions: ["reject"], // offered in this order, as the surface's actions
};
```

A `datetime` quick filter is a from/to range on the viewer's clock (gte/lte, either end optional). `Page.total` in the `DataAdapter` contract is optional: a server may answer with only `next`, an opaque cursor the client never parses (see `docs/records-protocol.md`).

## Options that live on the server

A select field's `options.values` is part of the document and is validated with it. When the choices live on the server, fill them into the document at host build time and validate after filling. The committed document may carry a placeholder only if your loader replaces it before validation. A dynamic option source is not part of the contract; a `reference` field is the in-contract way to point at server records. See `docs/records-protocol.md`.

## Exports

- Document types: `EntityDocument`, `FormView`, `TableView`, `CalendarView`, `BoardView`, `DashboardView`, `ViewerDocument` (with `ViewerFact`, `ResolvedViewer`), `Field`, `Condition` and `ViewerCondition` (the `viewerIn` subset for viewer-only places) and friends; `SPEC_VERSION`. RFC 0007 adds `RecordAction` (with `ActionConfirm`, `ActionInputField`, `ActionConfirmTone`), `ColumnCompare` and `CompareNeighbour` (`COMPARE_NEIGHBOURS`), the grid limits `ACTIONS_MAX`, `ACTION_INPUT_MAX`, `RECORD_ACTIONS_MAX`, and `isIsoDatetime` (the one canonical stored form a `datetime` value takes). RFC 0008/0009 add `TimeField`, `TagsField`, `SubRecordSection`, `NamedFilter`, the `fieldEqFact` leaf in `Condition`/`CONDITION_OPS`, `PagerProps`, and the board `columnsFrom`/calendar `doneField`/table `addForm` keys.
- `validateDocument`, `validateDocuments`, `migrate` (upgrades a document from an older `specVersion`; version 0 documents stay valid).
- `Registry<N>`: the exact-key map of field `Input`/`Display` components, layout pieces and widgets that the renderer looks components up in. `N` is the UI library's node type, so core needs no React. `layout.Calendar` (`CalendarProps`), `layout.Board` (`BoardProps`), `layout.Dialog` (`DialogProps`) and `layout.Pager` (`PagerProps`) are optional keys: without the first two, that view kind renders an error summary; without `Dialog`, an action that asks for confirmation or input reports an error instead; without `Pager`, a table keeps the renderer's own Previous/Next markup. `fields.datetime` is optional too: a registry without it renders datetime values through an error, the same way as any missing key. The `time` and `tags` field entries are required, like every other field type — a registry written before RFC 0008 must add them.
- `DataAdapter`, `Query`, `DataRecord` (with `can?: RecordPermissions`, whose `actions` map takes action ids away, and `version`), `Page` (`total` optional, `next` an opaque cursor — a page with neither is the last), `WriteMeta`, and the typed adapter errors (`RecordConflictError`, `RecordNotFoundError`, `RecordValidationError`, `UnauthorizedError`, `ForbiddenError`).
- `recordJsonSchema(entity)`: a standard JSON Schema (draft 2020-12) for a record's `values` under an entity, so a backend can validate records with any JSON Schema library. In the repo, `pnpm record-schema <entity.json>` prints it; see `docs/records-protocol.md` for what it cannot express.
- `describeContract()`: a plain JSON description of everything a document can contain (kinds, field types, condition ops, where each kind of condition may appear, relative dates, widgets, grid limits, the id pattern, error codes), generated from the constants the validator uses. In the repo, `pnpm describe-registry` prints it.

## Upgrading

Documents stamped older still validate; run `migrate()` to restamp them to the current `specVersion`. Each step so far only stamps the new version, so a document keeps its content.

## Rules worth knowing

- `specVersion` is the document format (currently 10); `revision` counts user edits to a document and is data.
- Ids (documents, fields, sections, tabs, grid items) match `[a-z][a-z0-9_]*`, e.g. `workout_set`; grid-item ids need only be unique within their tab.
- Conditions are a JSON AST. Date comparisons accept a relative date, `{ "daysFromToday": n }`, and `datetime` comparisons a relative instant, `{ "hoursFromNow": n }`; `viewerIn` tests a viewer fact.
- A table view or column can set `sortable: false` (a declared `sort` on such a column is a validation error). A field can be `readOnly` (server-set): it is refused as a form item, an editable column and an inline edit. `COLOR_PALETTE` is the eight-colour palette that option and reference colours are checked against (an off-palette hex is a warning).

See the [repo README](../../README.md) and [ARCHITECTURE.md](../../ARCHITECTURE.md).
