# @yadad/editor

Visual editors for yadad documents. Every change is a JSON Patch against an entity or view document, with undo and redo from the patch log; saving hands back the edited document with its `revision` bumped. The editor writes documents, never records.

```sh
npm install @yadad/editor @yadad/core @yadad/runtime react
```

Peer dependency: React 19.

## Components

Each takes the document, an injected `Registry<ReactNode>`, and `onSave` / `onCancel`:

- `EntityFieldsEditor`: add a field, change its label, options or required flag, or remove one no view uses. Ids and types of existing fields are fixed because saved records depend on them. Takes `views` so it can refuse removing a field still in use.
- `FormViewEditor`: place entity fields in sections, reorder, and add, rename or remove sections. Conditions on fields are kept and shown.
- `TableViewEditor`: choose and order columns, which are editable in place, the title, sorting, page size, and quick filters.
- `CalendarViewEditor`: title, title and detail fields, colour field, modes, week start, whether moving an entry changes its date, a fixed filter and the row action.
- `BoardViewEditor`: title, title field, card fields, the `groupBy` fields the viewer may choose among (select, boolean or reference fields; the first is the default), whether dragging a card moves it, card order within a column, a fixed filter and the row action. Groupings and card fields reorder by grip, arrow keys or Move buttons, and each move is announced.
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

### Preview every state

`StatesPreview` sits next to a view editor and shows the view in each state it can be in (from `viewStates` in `@yadad/runtime`), marking the ones that are new or look different from the saved revision and naming the viewer facts the view reads. Feed it from an editor's `onChange`, which reports the document after every edit, undo or redo. The editor cannot import renderers or the test kit, so the host passes `renderState` and, optionally, `checkStates` (for example `checkViewStates` from `@yadad/testing/state-checks`).

```tsx
const [edited, setEdited] = useState(board);

<BoardViewEditor view={board} entity={task} registry={registry} onChange={setEdited} onSave={save} onCancel={close} />
<StatesPreview view={edited} saved={board} documents={documents} now={new Date()}
  renderState={(state, docs) => <MyBoard state={state} documents={docs} />} />
```

Property panels are built from an exhaustive per-field-type map, so a new field type cannot ship without an editor.

## Helpers

- `blankEntity(id)`, `blankForm(entity, id, dataSource)`, `blankTable(entity, id, dataSource)`, `blankCalendar(...)` and `blankBoard(...)` (the last three null while the entity has nothing to show, such as no date field for a calendar or no groupable field for a board), `blankDashboard(id, title?)` and `blankViewer(id?)` create starting documents.
- `startSession`, `edit`, `undo`, `redo`, `isDirty` and `finish` drive an `EditSession` directly if you build your own UI.
- `idFromTitle(title, used, fallback)` turns a title into a valid id that is unique among `used`.

See the [repo README](../../README.md) and [ARCHITECTURE.md](../../ARCHITECTURE.md).
