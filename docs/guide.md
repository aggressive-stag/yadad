# Guide, part 1: from documents to a dashboard

This guide builds a small team-tasks app one document at a time. You end with a form, a table you can add to and edit, a board, a calendar, a dashboard and one rule that depends on who is looking. It uses an in-memory data source, so there is no backend yet. Part 2 puts a server behind the same app.

The app is the starter in [`examples/starter`](../examples/starter). Every file in this guide is quoted from it, and a test (`examples/starter/tests/guide.test.ts`) fails when the guide and the starter drift apart. The only exceptions are the two files in step 6, which the starter does not have; the test checks those too.

You need Node 22.18 or newer and a checkout of this repository. The [toolchain table](../README.md#tested-with) lists what is tested.

## How the app works

A yadad app has three parts:

- **Documents.** JSON files that say what the data is (entities) and what each screen shows (views). They are the app.
- **A registry.** A set of components that draw the fields, tables and buttons. The starter uses `@yadad/components`. Documents never name a component.
- **A data source.** An adapter that loads and saves records. This guide uses `createMemoryAdapter`, which keeps records in the browser and forgets them on reload.

The renderers read the documents, ask the registry for components and ask the data source for records. Read [ARCHITECTURE.md](../ARCHITECTURE.md#5-runtime-model-two-inputs-two-writers) for the full picture.

## Step 0: set up the starter without its documents

Install and start the starter on the in-memory data source:

```sh
pnpm install
pnpm --filter @yadad/example-starter dev:memory
```

Open the address Vite prints. You see the finished app. To build it up yourself, move its documents aside. They come back with `git checkout examples/starter/documents`:

```sh
cd examples/starter
mv documents documents.final && mkdir documents
```

The host code stays. It is short, and it is why adding a file adds a screen. The starter's `src/main.tsx` puts the theme on the page and checks the documents before it draws anything:

<!-- excerpt: src/main.tsx -->
```tsx
const style = document.createElement("style");
style.textContent = themeToCss(lightTheme) + themeToCss(darkTheme, "[data-theme=dark]");
document.head.append(style);
```

That `<style>` tag is not optional. The components read `--yadad-*` variables, and without them the page is unstyled and nothing says why. The next lines check every document:

<!-- excerpt: src/main.tsx -->
```tsx
const result = validateDocuments(documents);
if (!result.ok) {
  // An invalid document shows its errors instead of the app.
```

`src/documents.ts` loads every file in `documents/` and builds the navigation from the views it finds:

<!-- excerpt: src/documents.ts -->
```ts
const files = import.meta.glob("../documents/*.json", { eager: true, import: "default" });
```

And `src/App.tsx` hands each view to the renderer for its kind:

<!-- excerpt: src/App.tsx -->
```tsx
  switch (view.kind) {
    case "form":
      // After a save the checklist hangs off the saved record (a sub-record needs a parent).
      return <FormRenderer entity={entity} view={view} {...shared} {...(saved ? { parent: saved } : {})} onSaved={setSaved} />;
    case "table":
      return <TableRenderer entity={entity} view={view} {...shared} reloadKey={saves} onChanged={bump} {...(filter ? { savedFilter: filter } : {})} onSavedFilterChange={setFilter} />;
```

The rest of this guide only adds files to `documents/`. Keep the dev server running and watch the page.

## Step 1: entities, and a first form

An **entity** is the data model: its fields, their types and their rules. Views can only make the rules stricter, never looser. Start with two entities, a person and a task. The task has a `reference` field that points at a person, and a `select` field with a fixed list of choices. See the [document reference](reference.md#entity-and-field-types) for every field type.


<!-- step 1: documents/person.json -->
```json
{
  "kind": "entity", "specVersion": 10, "id": "person", "revision": 1,
  "fields": [
    { "id": "name", "type": "text", "label": "Name", "required": true }
  ]
}
```

<!-- step 1: documents/task.json -->
```json
{
  "kind": "entity", "specVersion": 10, "id": "task", "revision": 1,
  "fields": [
    { "id": "title", "type": "text", "label": "Title", "required": true },
    { "id": "assignee", "type": "reference", "label": "Assignee", "entity": "person", "display": "name" },
    { "id": "status", "type": "select", "label": "Status", "required": true,
      "options": { "source": "static", "values": ["To do", "In progress", "Blocked", "Done"] } },
    { "id": "due", "type": "date", "label": "Due" },
    { "id": "notes", "type": "text", "label": "Notes", "multiline": true }
  ]
}
```

Now the first screen. A **form** creates a record of one entity. It lists the fields it shows, in sections:


<!-- step 1: documents/person_form.json -->
```json
{
  "kind": "form", "specVersion": 10, "id": "person_form", "entity": "person", "revision": 1, "dataSource": "default",
  "sections": [{ "id": "main", "title": "New person", "items": [{ "field": "name" }] }]
}
```

The page now has one screen, a form for a new person. Leave the name empty and press Save: the form says the field is required, because the entity says so. Type a name and save, and the person is stored (in memory, until you reload).

![The person form](../examples/starter/docs/screens/person_form-1280.png)

## Step 2: a task form and a table

A task can have a checklist of steps. A step is its own record, so it is a second entity that points back at its task:


<!-- step 2: documents/subtask.json -->
```json
{
  "kind": "entity", "specVersion": 10, "id": "subtask", "revision": 1,
  "fields": [
    { "id": "task", "type": "reference", "label": "Task", "entity": "task", "display": "title", "required": true },
    { "id": "title", "type": "text", "label": "Step", "required": true },
    { "id": "done", "type": "boolean", "label": "Done" },
    { "id": "position", "type": "number", "label": "Position", "min": 0 }
  ]
}
```

The task form uses two rules. `requiredWhen` makes Notes required only while the status is Blocked. The `subRecords` section is the checklist: each step is a `subtask` record whose `task` field names the task. A new task has no record yet, so the checklist appears once the task is saved. The starter's `App.tsx` passes the saved record to the form as its `parent`.


<!-- step 2: documents/task_form.json -->
```json
{
  "kind": "form", "specVersion": 10, "id": "task_form", "entity": "task", "revision": 1, "dataSource": "default",
  "sections": [
    { "id": "details", "title": "Task", "items": [
      { "field": "title" },
      { "field": "assignee" },
      { "field": "status" },
      { "field": "due" },
      { "field": "notes", "requiredWhen": { "op": "eq", "field": "status", "value": "Blocked" } }
    ] },
    { "id": "checklist", "title": "Checklist",
      "subRecords": { "entity": "subtask", "via": "task", "titleField": "title", "doneField": "done", "orderField": "position", "addLabel": "Add step" } }
  ]
}
```

A **table** lists the records of one entity. Its columns can be editable in place, and `addForm` adds an "add" button that opens a form over the same entity. The saved filters are chips the viewer can switch; which chip is lit is the host's state, and the starter keeps it in `App.tsx`.


<!-- step 2: documents/tasks.json -->
```json
{
  "kind": "table", "specVersion": 10, "id": "tasks", "title": "Tasks", "entity": "task", "revision": 1, "dataSource": "default",
  "columns": [
    { "field": "title", "editable": true },
    { "field": "assignee" },
    { "field": "status", "editable": true },
    { "field": "due", "editable": true }
  ],
  "sort": [{ "field": "due", "dir": "asc" }],
  "pageSize": 10,
  "addForm": "task_form",
  "filters": [
    { "id": "open", "name": "Open", "condition": { "op": "neq", "field": "status", "value": "Done" } },
    { "id": "overdue", "name": "Overdue", "condition": { "op": "and", "conditions": [
      { "op": "neq", "field": "status", "value": "Done" },
      { "op": "lt", "field": "due", "value": { "daysFromToday": 0 } }
    ] } }
  ]
}
```

Open the Tasks screen. The seed records are there. Press Edit on a row, change a status or a date and press Save: the table checks the edit against the entity and saves the changed fields. Use Add to open the task form. (A form creates records. Existing records are edited in the table.) Try the Open and Overdue chips.

![The tasks table](../examples/starter/docs/screens/tasks-1280.png)

## Step 3: drill from a row into another table

A table's `rowAction` opens another table from a row and fills that table's filter from the row. Here a click on a person opens the tasks of that person. The `bind` pairs a field of this row (`id`, the record's own id) with a field of the target table's entity (`assignee`).


<!-- step 3: documents/person_tasks.json -->
```json
{
  "kind": "table", "specVersion": 10, "id": "person_tasks", "title": "Tasks of one person", "entity": "task", "revision": 1, "dataSource": "default",
  "columns": [{ "field": "title" }, { "field": "status" }, { "field": "due" }],
  "sort": [{ "field": "due", "dir": "asc" }]
}
```

<!-- step 3: documents/people.json -->
```json
{
  "kind": "table", "specVersion": 10, "id": "people", "title": "People", "entity": "person", "revision": 1, "dataSource": "default",
  "columns": [{ "field": "name", "editable": true }],
  "sort": [{ "field": "name", "dir": "asc" }],
  "addForm": "person_form",
  "rowAction": { "open": "person_tasks", "bind": [{ "field": "id", "to": "assignee" }] }
}
```

The target table does not appear in the navigation: the starter hides every view that another view opens. Click a person to see their tasks.

![The people table](../examples/starter/docs/screens/people-1280.png)

## Step 4: a board and a calendar over the same entity

A **board** shows records as cards in columns, one column per value of a field. `groupBy` lists the fields the viewer can group by, and `editable` lets them drag a card to another column, which changes that field. A **calendar** places records on days by a date field, and dragging an entry to another day changes the date.


<!-- step 4: documents/board.json -->
```json
{
  "kind": "board", "specVersion": 10, "id": "board", "title": "Board", "entity": "task", "revision": 1, "dataSource": "default",
  "groupBy": [{ "field": "status" }, { "field": "assignee" }],
  "titleField": "title", "cardFields": ["assignee", "due"],
  "editable": true
}
```

<!-- step 4: documents/calendar.json -->
```json
{
  "kind": "calendar", "specVersion": 10, "id": "calendar", "title": "Calendar", "entity": "task", "revision": 1, "dataSource": "default",
  "dateField": "due", "titleField": "title", "colorField": "status", "editable": true
}
```

Neither view needed a new entity or any code. The board groups by status or by assignee; the calendar uses the due date and colours entries by status.

![The board](../examples/starter/docs/screens/board-1280.png)

## Step 5: a dashboard

A **dashboard** is tabs of grid items, each with a position and size. This one has three counts, a chart and the tasks table itself. A `count` counts the records of a table view, with an optional extra `filter`. A `series` groups a table view by one field and draws one number per group, here as a bar chart. A `view` widget embeds another view by id. A dashboard never repeats a view; it points at it.


<!-- step 5: documents/overview.json -->
```json
{
  "kind": "dashboard", "specVersion": 10, "id": "overview", "title": "Overview", "revision": 1,
  "tabs": [{ "id": "main", "title": "Overview", "columns": 12, "items": [
    { "id": "open_count", "widget": "count", "label": "Open tasks", "view": "tasks",
      "filter": { "op": "neq", "field": "status", "value": "Done" }, "x": 0, "y": 0, "w": 4, "h": 2 },
    { "id": "blocked_count", "widget": "count", "label": "Blocked", "view": "tasks",
      "filter": { "op": "eq", "field": "status", "value": "Blocked" }, "x": 4, "y": 0, "w": 4, "h": 2 },
    { "id": "all_count", "widget": "count", "label": "All tasks", "view": "tasks", "x": 8, "y": 0, "w": 4, "h": 2 },
    { "id": "by_status", "widget": "series", "label": "Tasks by status", "view": "tasks",
      "groupBy": { "field": "status" }, "measure": { "op": "count" }, "display": "bar", "x": 0, "y": 2, "w": 6, "h": 8 },
    { "id": "tasks_view", "widget": "view", "view": "tasks", "x": 6, "y": 2, "w": 6, "h": 8 }
  ] }]
}
```

![The overview dashboard](../examples/starter/docs/screens/overview-1280.png)

## Step 6: one rule that depends on who is looking

A **viewer** document declares facts about the person looking: a role, a plan, a flag. Views read them with `viewerIn`. Declare one fact, `role`, and make its default the least privileged value, because that is what a person gets when the host says nothing. The starter has no viewer document. Add this file:


<!-- new: documents/viewer.json -->
```json
{
  "kind": "viewer", "specVersion": 10, "id": "viewer", "revision": 1,
  "facts": [
    { "id": "role", "label": "Role", "type": "select", "default": "member",
      "options": { "source": "static", "values": ["member", "lead"] } }
  ]
}
```

Then change `documents/tasks.json` to add a Notes column that only a lead sees. This is the whole file with that one column added:


<!-- changed: documents/tasks.json -->
```json
{
  "kind": "table", "specVersion": 10, "id": "tasks", "title": "Tasks", "entity": "task", "revision": 1, "dataSource": "default",
  "columns": [
    { "field": "title", "editable": true },
    { "field": "assignee" },
    { "field": "status", "editable": true },
    { "field": "due", "editable": true },
    { "field": "notes", "visibleWhen": { "op": "viewerIn", "fact": "role", "values": ["lead"] } }
  ],
  "sort": [{ "field": "due", "dir": "asc" }],
  "pageSize": 10,
  "addForm": "task_form",
  "filters": [
    { "id": "open", "name": "Open", "condition": { "op": "neq", "field": "status", "value": "Done" } },
    { "id": "overdue", "name": "Overdue", "condition": { "op": "and", "conditions": [
      { "op": "neq", "field": "status", "value": "Done" },
      { "op": "lt", "field": "due", "value": { "daysFromToday": 0 } }
    ] } }
  ]
}
```

The table now hides the Notes column from everyone, because every viewer is a `member` by default. To let a person in as a lead, the host passes the viewer to the renderer. The renderers already find the viewer document through the `documents` prop; this call overrides the default with what the host knows:

```tsx
import { findViewerDocument, resolveViewer } from "@yadad/runtime";

const { viewer } = resolveViewer(findViewerDocument(documents), [{ fact: "role", value: "lead" }]);
// <TableRenderer ... viewer={viewer} />
```

The rule only changes what the screen offers. The server is the only authority on what a person may read or write, so it must never send data a viewer may not read. See the [records protocol](records-protocol.md).

## Step 7: check the documents, and what a mistake looks like

The starter shows validation errors instead of the app, so a mistake in a document is hard to miss. The same check runs from the command line, which is what a build or CI should run:

<!-- excerpt: scripts/check-documents.ts -->
```ts
const result = validateDocuments(docs);
if (result.ok) console.log(`OK: ${files.length} documents valid.`);
```

Run it:

```sh
pnpm --filter @yadad/example-starter check
```

Break a document on purpose. In `documents/tasks.json`, misspell the first column's field as `"titel"` and run the check again. This is the output of a real run:

<!-- output: check -->
```text
documents/tasks.json /columns/0/field [unknown-reference] Field "titel" is not on entity "task".
```

The first part is the file, the second is a JSON Pointer to the exact place (the first column's `field`), then the error code and a message that says what is wrong. In the browser, the same error replaces the app until you fix it. Every error also carries a `hint` that says what to do. Fix the spelling and the check prints `OK`.

Two more checks are worth adding when the app grows. `validateDocuments` checks one set at a time, so run it on everything. And `checkViewStates` from `@yadad/testing/state-checks` renders every view in every state it can be in (empty, full, loading, failed, refused, as each viewer) and names what breaks. The starter's `tests/views.test.tsx` shows both.

## Where to go next

- Put your own documents in a copy of the starter: its README has the steps to take it out of the repository.
- [Document reference](reference.md): everything a document can contain, with an example of each kind.
- Part 2 (a backend behind the app) follows in this guide.
- [ARCHITECTURE.md](../ARCHITECTURE.md): the design, section by section.
