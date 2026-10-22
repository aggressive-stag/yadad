# @yadad/editor

Visual editors for yadad documents. Every change is a JSON Patch against an entity or view document, with undo and redo from the patch log; saving hands back the edited document with its `revision` bumped. The editor writes documents, never records.

```sh
npm install @yadad/editor @yadad/core @yadad/runtime react
```

Peer dependency: React 19.

## Components

Each takes the document, an injected `Registry<ReactNode>`, and `onSave` / `onCancel`. Every editor also takes `onChange`, which reports the in-progress document after every edit, undo or redo — that is what feeds a live preview or an unsaved-JSON panel; `onSave` alone only fires on the Save press.

- `EntityFieldsEditor`: add a field, change its label, options or required flag, or remove one no view uses. Ids and types of existing fields are fixed because saved records depend on them. Takes `views` so it can refuse removing a field still in use. Its **Actions** section declares what a record can do (RFC 0007): add, rename, reorder and remove record actions, set each one's confirm (title, message, confirm label, tone), author its input fields (up to 5, of the types with a plain input — no `reference`) and its `visibleWhen`. Removal is refused while a view still offers the action, naming the views. Ids of existing actions are fixed, because views offer them by id.
- `FormViewEditor`: place entity fields in sections, reorder, and add, rename or remove sections. Conditions on fields are kept and shown.
- `TableViewEditor`: choose and order columns, which are editable in place, the title, sorting, page size, and quick filters. A text column can be set to **compare** — against the previous or next row, or another text field (mutually exclusive with editable in place). Offers actions per record with the "Offer actions" pick.
- `CalendarViewEditor`: title, title and detail fields, colour field, modes, week start, whether moving an entry changes its date, a fixed filter, the row action, and the actions offered on each entry.
- `BoardViewEditor`: title, title field, card fields, the `groupBy` fields the viewer may choose among (select, boolean or reference fields; the first is the default), whether dragging a card moves it, card order within a column, a fixed filter, the row action, and the actions offered on each card. Groupings and card fields reorder by grip, arrow keys or Move buttons, and each move is announced.
- `ViewerPanel`: declare the facts of a `viewer` document: add, remove, reorder and relabel facts, edit a select fact's values and each default. A fact's id and type are fixed once created, and a value is removed and re-added rather than renamed. Given `documents`, removing a fact or value that a condition still reads is refused and the places that read it are listed.
- `DashboardLayoutEditor`: tabs and a 12-column grid of form, table, calendar, board and count widgets. Drag and resize are hand-written over CSS grid with pointer and full keyboard support. Optional `views`, `entities` and `describeView` supply the widget palette and readable names.

```tsx
import { FormViewEditor } from "@yadad/editor";

<FormViewEditor view={form} entity={entity} registry={registry} onSave={(next) => save(next)} onCancel={close} />;
```

### Who is viewing

Pass the set's viewer document as the `viewer` prop of any view editor (`FormViewEditor`, `TableViewEditor`, `CalendarViewEditor`, `BoardViewEditor`, `DashboardLayoutEditor`) and the editor offers viewer rules where the contract allows them: `visibleWhen` on columns, tabs, widgets and row actions, `editableWhen` on columns, calendars and boards, and a "The viewer" source in the condition builder for form items. Without `viewer`, nothing changes. Turning editing off also drops `editableWhen`.

```tsx
<BoardViewEditor view={board} entity={task} registry={registry} viewer={viewerDocument} onSave={save} onCancel={close} />
```

### Authoring a review screen

The pieces RFC 0007 needs are all editable: the entity's Actions section declares the actions (`apply`, `reject`, `restore`, ...), and the table, calendar and board editors' "Offer actions" panel picks, per view, the actions it offers on each record — an ordered pick of the entity's actions (1 to 6, each once), shown in this order. The candidate goes through the validator, so an action removed from the entity since the panel opened is refused, not saved. The patch helpers are exported for your own UI: `addAction`, `updateAction`, `moveAction`, `removeAction`, `actionReferences` (which views offer an action), plus the input-field and visibility helpers. Property panels are built from an exhaustive per-field-type map, so a new field type — `datetime` included — cannot ship without an editor; a datetime property panel edits its bounds like a date's.

### Preview every state

`StatesPreview` sits next to a view editor and shows the view in each state it can be in (from `viewStates` in `@yadad/runtime`), marking the ones that are new or look different from the saved revision and naming the product axes it varies — the viewer facts the view reads, which actions it offers, how its page is described. Offer a record action or add a `datetime` field and new states appear marked; take it away and the grid settles back. Feed it from an editor's `onChange`, which reports the document after every edit, undo or redo. The editor cannot import renderers or the test kit, so the host passes `renderState` and, optionally, `checkStates` (for example `checkViewStates` from `@yadad/testing/state-checks`).

```tsx
const [edited, setEdited] = useState(board);

<BoardViewEditor view={board} entity={task} registry={registry} onChange={setEdited} onSave={save} onCancel={close} />
<StatesPreview view={edited} saved={board} documents={documents} now={new Date()}
  renderState={(state, docs) => renderPreviewState(state, docs, registry, new Date())} />
```

`renderState` is the ~40 lines every host writes — the same switch the showcase's states page runs, reproduced here so you do not have to read that app to find it. One fresh `createStateAdapter(state)` (`@yadad/testing`) per state, mapped under **every** `dataSource` key the set names: tables, boards and calendars name one each, and dashboard widgets name keys too, so collect them from all documents, dashboards included. The state seeds the renderer — `initialMode`/`initialAnchor` for a calendar, `initialGroupBy` for a board, `initialTab` for a dashboard — and `key={state.id}` remounts the renderer per state so the seed applies. A form state's values arrive through the draft store; pass `drafts` or the form renders blank. `documentSet(documents)` gives the entities/views/viewer lookup the renderers want, and the "viewer not provided" state (`state.omitViewer`) renders with the `viewer` prop left out.

```tsx
import { createStateAdapter } from "@yadad/testing"; // a host may keep its own seeded adapter; the test kit's is what previews use
import { BoardRenderer, CalendarRenderer, DashboardRenderer, FormRenderer, TableRenderer, documentSet } from "@yadad/renderer";
import { createDraftStore } from "@yadad/runtime";
import type { DraftStore, ViewState } from "@yadad/runtime";
import type { DataAdapter, Document, Registry } from "@yadad/core";
import type { ReactNode } from "react";

function renderPreviewState(state: ViewState, documents: readonly Document[], registry: Registry<ReactNode>, now: Date): ReactNode {
  const set = documentSet(documents); // entities + views + viewer by id
  const view = set.views.get(state.render.view);
  if (!view) return null;
  const entity = "entity" in view ? set.entities.get(view.entity) : undefined;
  // One fresh adapter per state, mapped under every data-source key the set
  // names — dashboard widgets name keys too, so dashboards are included.
  const adapter = createStateAdapter(state);
  const keys = new Set(documents.flatMap((d) => (d.kind !== "entity" && d.kind !== "viewer" && "dataSource" in d ? [d.dataSource] : [])));
  const dataSources = new Map<string, DataAdapter>([...keys].map((k) => [k, adapter]));
  // The state's viewer goes to the renderer; the "viewer not provided" state omits the prop.
  const viewer = state.omitViewer ? {} : { viewer: state.viewer };
  switch (view.kind) {
    case "form": {
      // A form state's values arrive through the draft store, or the form renders blank.
      let drafts: { readonly store: DraftStore } | undefined;
      if (state.render.kind === "form" && entity && Object.keys(state.render.values).length > 0) {
        const data = new Map<string, string>();
        const store = createDraftStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) });
        store.save(state.render.view, undefined, { values: state.render.values, entityRevision: entity.revision, savedAt: now.getTime() });
        drafts = { store };
      }
      return entity ? <FormRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} entities={set.entities} {...(drafts ? { drafts } : {})} {...viewer} /> : null;
    }
    case "table":
      return entity ? <TableRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} entities={set.entities} documents={set} {...viewer} /> : null;
    case "calendar":
      // The state names the mode and the day it opens on; key remounts it per state so the seed applies.
      return entity && state.render.kind === "calendar" ? <CalendarRenderer key={state.id} initialMode={state.render.mode} initialAnchor={state.render.anchor} entity={entity} view={view} registry={registry} dataSources={dataSources} entities={set.entities} documents={set} now={now} {...viewer} /> : null;
    case "board":
      // The state names the field the board is grouped by; the viewer may still switch after.
      return entity && state.render.kind === "board" ? <BoardRenderer key={state.id} initialGroupBy={state.render.groupBy} entity={entity} view={view} registry={registry} dataSources={dataSources} entities={set.entities} documents={set} {...viewer} /> : null;
    case "dashboard":
      // The state names the tab it sits on; initialTab opens it on mount.
      return state.render.kind === "dashboard" ? <DashboardRenderer key={state.id} dashboard={view} documents={set} registry={registry} dataSources={dataSources} initialTab={state.render.tab} {...viewer} /> : null;
  }
}
```

This exact function is compiled and run by `apps/showcase/src/readme-preview-sample.test.tsx` — if the renderers' props change, that test fails and this sample is fixed with it.

Two facts about the host side, learned the hard way by more than one consumer:

- **Save bumps `revision`, so do not key the editor on the document.** `<BoardViewEditor key={view.id + view.revision} …>` remounts the editor after every save and the undo stack resets — Undo stops working right after the first Save. Key it on the id only, or not at all; the editors follow `view` by prop, not by remount.
- **`STATES_PREVIEW_DEFAULT_LIMIT` (12) caps the preview.** A wide view — a dashboard with several tabs, a board with several groupings — has more states than that, and the grid quietly shows the first twelve. Pass `limit` to raise it (exported from `@yadad/editor`).


Property panels are built from an exhaustive per-field-type map, so a new field type cannot ship without an editor.

## Helpers

- `blankEntity(id)`, `blankForm(entity, id, dataSource)`, `blankTable(entity, id, dataSource)`, `blankCalendar(...)` and `blankBoard(...)` (the last three null while the entity has nothing to show, such as no date field for a calendar or no groupable field for a board), `blankDashboard(id, title?)` and `blankViewer(id?)` create starting documents.
- `startSession`, `edit`, `undo`, `redo`, `isDirty` and `finish` drive an `EditSession` directly if you build your own UI.
- `idFromTitle(title, used, fallback)` turns a title into a valid id that is unique among `used`.

See the [repo README](../../README.md) and [ARCHITECTURE.md](../../ARCHITECTURE.md).
