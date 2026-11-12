# Document reference

What a document can contain, one section per kind, with an example for each. Every example is a complete document and every one validates: a test (`testing/src/reference-examples.test.ts`) loads them together as one set, so the examples refer to each other by id. The keys come from `describeContract()`. For the exact, current list for the version you installed, run `pnpm describe-registry` (or `--json`).

The examples use the set below. Each section adds one or two documents to it.

- [Entity and field types](#entity-and-field-types)
- [Viewer](#viewer)
- [Conditions](#conditions)
- [Form](#form)
- [Table](#table)
- [Calendar](#calendar)
- [Board](#board)
- [Dashboard and widgets](#dashboard-and-widgets)

## Entity and field types

An **entity** is the data model: its fields, their types and the rules a record must meet. Views never change these rules, they can only make them stricter. An entity can also declare `actions`, commands a record can run (see [Table](#table)).

The field types are `text`, `number`, `boolean`, `select`, `date`, `datetime`, `reference`, `time` and `tags`.

- `text`: a short or long text. `multiline` shows a textarea; `maxLength` caps the length.
- `number`: a number, with optional `min`, `max`, `step` and a `unit` shown next to it.
- `boolean`: yes or no. A required boolean must be true (a "I agree" box).
- `select`: a fixed list of choices in `options`. An entry is a text, or `{ "value", "label", "color" }`.
- `date`: a calendar day stored as `"YYYY-MM-DD"`, with optional `min` and `max`.
- `datetime`: an instant stored in one form, UTC with milliseconds and a trailing `Z`. Cells show the viewer's zone and locale.
- `reference`: the id of a record of another entity (`entity`), shown by the target's `display` field.
- `time`: a time of day stored as `"HH:MM"`, with optional `min`, `max` and a `step` in minutes.
- `tags`: a list of text values, in the order entered. It is the only field type whose value is an array. Conditions match any element; it never sorts or groups.

A field may also be `required` (every record needs a value) or `readOnly` (the server sets it; it is shown but never sent back). `readOnly` combined with `required` is valid.

```json
{
  "kind": "entity", "specVersion": 10, "id": "project", "revision": 1,
  "fields": [{ "id": "name", "type": "text", "label": "Name", "required": true }]
}
```

```json
{
  "kind": "entity", "specVersion": 10, "id": "task", "revision": 1,
  "fields": [
    { "id": "title", "type": "text", "label": "Title", "required": true, "maxLength": 120 },
    { "id": "notes", "type": "text", "label": "Notes", "multiline": true },
    { "id": "points", "type": "number", "label": "Points", "min": 0, "max": 40, "step": 1, "unit": "pts" },
    { "id": "done", "type": "boolean", "label": "Done" },
    { "id": "status", "type": "select", "label": "Status", "options": { "source": "static", "values": ["open", "doing", "closed"] } },
    { "id": "due", "type": "date", "label": "Due" },
    { "id": "started", "type": "datetime", "label": "Started" },
    { "id": "at", "type": "time", "label": "Reminder", "step": 15 },
    { "id": "project", "type": "reference", "label": "Project", "entity": "project", "display": "name" },
    { "id": "labels", "type": "tags", "label": "Labels" }
  ],
  "actions": [
    { "id": "archive", "label": "Archive", "confirm": { "message": "Archive this task?", "subjectField": "title", "tone": "danger" } }
  ]
}
```

A second entity for checklists, used by the form below:

```json
{
  "kind": "entity", "specVersion": 10, "id": "step", "revision": 1,
  "fields": [
    { "id": "text", "type": "text", "label": "Step", "required": true },
    { "id": "done", "type": "boolean", "label": "Done" },
    { "id": "task", "type": "reference", "label": "Task", "entity": "task" },
    { "id": "order", "type": "number", "label": "Order" }
  ]
}
```

Actions: an entity has at most 12 `actions`. Each is `{ id, label }` with an optional `confirm` (asks first, in a dialog), optional `input` fields (the dialog collects 1 to 5 values) and an optional `visibleWhen`. A view offers some of them per row with `recordActions` (see [Table](#table)). The server runs them; see the records protocol.

## Viewer

A **viewer** document declares the facts a host can tell the renderers about the person looking: a role, a plan, a flag. Conditions read them with `viewerIn`. A set has at most one. It draws nothing. The facts are `select` (2 to 8 values) or `boolean`, each with a `default`; pick the least privileged default, because it is what a viewer gets when the host says nothing.

```json
{
  "kind": "viewer", "specVersion": 10, "id": "viewer", "revision": 1,
  "facts": [
    { "id": "role", "label": "Role", "type": "select", "default": "reader", "options": { "source": "static", "values": ["reader", "editor"] } },
    { "id": "home", "label": "Home project", "type": "select", "default": "none", "options": { "source": "static", "values": ["none", "p1"] } }
  ]
}
```

## Conditions

A **condition** is a small JSON tree that decides whether something is shown, required, editable or matched. There are no string expressions. The operators:

- Compare a field with a value: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in` (a list under `values`), `contains` (text, or any element of a tags field).
- Check for a value: `empty`, `notEmpty`.
- Combine: `and` and `or` (a list under `conditions`), `not` (one `condition`).
- Look at the viewer: `viewerIn` (the viewer's value of a fact is one of `values`) and `fieldEqFact` (the record's value of a field equals the viewer's value of a fact).

Date values can be relative: `{ "daysFromToday": -7 }`. The runtime resolves them to a day before any query is sent. A condition that is sent to the server as a filter cannot read the viewer. Conditions that decide what a viewer sees (columns, tabs, widgets, actions) can only read the viewer. Form fields can read both. The examples are in the form, table and dashboard below.

## Form

A **form** creates a record of one entity. Sections hold items; each item names a field and can carry `visibleWhen`, `requiredWhen` and `clearWhenHidden` (drop the typed value when the field hides). A form only creates new records.

```json
{
  "kind": "form", "specVersion": 10, "id": "new_task", "entity": "task", "revision": 1, "dataSource": "default",
  "sections": [
    { "id": "main", "title": "New task", "items": [
      { "field": "title" },
      { "field": "status" },
      { "field": "points", "visibleWhen": { "op": "neq", "field": "status", "value": "closed" } },
      { "field": "notes", "requiredWhen": { "op": "and", "conditions": [{ "op": "eq", "field": "status", "value": "doing" }, { "op": "empty", "field": "labels" }] } },
      { "field": "labels", "visibleWhen": { "op": "viewerIn", "fact": "role", "values": ["editor"] } }
    ] }
  ]
}
```

- **Batch composer.** `"repeat": "batch"` shows the field set several times and creates all the records in one write that either saves them all or none.
- **Checklist.** A section with `subRecords` is an inline checklist over a child entity: each step is its own record that points back at the parent through the `via` reference field. The form only hosts the editing; a create form has no parent record yet, so the section says so until the record exists (the host passes the parent record to the form).

```json
{
  "kind": "form", "specVersion": 10, "id": "task_batch", "entity": "task", "revision": 1, "dataSource": "default", "repeat": "batch",
  "sections": [
    { "id": "main", "items": [{ "field": "title" }, { "field": "project", "visibleWhen": { "op": "fieldEqFact", "field": "project", "fact": "home" } }] },
    { "id": "steps", "title": "Steps", "subRecords": { "entity": "step", "via": "task", "titleField": "text", "doneField": "done", "orderField": "order", "addLabel": "Add a step" } }
  ]
}
```

## Table

A **table** lists the records of one entity as rows. Columns can be `editable` (an inline edit saves one record at a time), hidden or locked for some viewers (`visibleWhen`, `editableWhen`), or compare their text with the neighbouring row.

Table keys:

- `sort` is the initial sort, `sortable: false` turns sorting off for a list the server serves in one order, `pageSize` is rows per page (1 to 1000).
- `filter` is a condition every row must match. It cannot read the viewer.
- `filters` are named saved filters: each is `{ id, name, condition }`, shown as chips. Which one is selected is the host's business.
- `quickFilters` give the viewer controls over fields; each may carry a `default`, a `label` and a `placeholder`.
- `addForm` names a form over the same entity; the table then offers an add button that opens it.
- `rowAction` opens another table view from a row and fills its filter from the row (`bind`). It opens table views only.
- `recordActions` lists the entity's actions this view offers on each row. A press runs, or asks first. An action the record or viewer withholds is not rendered.
- A column's `compare` shows what changed in a text cell, against the previous or next row, or against another text field of the same record.

```json
{
  "kind": "table", "specVersion": 10, "id": "tasks", "title": "Tasks", "entity": "task", "revision": 1, "dataSource": "default",
  "columns": [
    { "field": "title", "compare": { "to": "previousRow" } },
    { "field": "status" }, { "field": "due" }, { "field": "points", "editable": true, "editableWhen": { "op": "viewerIn", "fact": "role", "values": ["editor"] } },
    { "field": "labels", "visibleWhen": { "op": "viewerIn", "fact": "role", "values": ["editor"] } }
  ],
  "sort": [{ "field": "due", "dir": "asc" }], "pageSize": 20,
  "filter": { "op": "gte", "field": "due", "value": { "daysFromToday": -7 } },
  "filters": [{ "id": "open", "name": "Open", "condition": { "op": "neq", "field": "status", "value": "closed" } }],
  "quickFilters": [{ "field": "status", "default": "open" }, { "field": "title", "placeholder": "Search" }],
  "addForm": "new_task", "rowAction": { "open": "task_steps", "bind": [{ "field": "id", "to": "task" }] },
  "recordActions": ["archive"]
}
```

```json
{
  "kind": "table", "specVersion": 10, "id": "task_steps", "title": "Steps", "entity": "step", "revision": 1, "dataSource": "default",
  "columns": [{ "field": "text" }, { "field": "done" }]
}
```

When the server answers a page with a `next` cursor and no total, the table pages with Previous and Next. A server can also send a `notice` with a page; the table shows it in a status region.

## Calendar

A **calendar** places records on the days of a month or week by one `date` field. With `editable`, moving an entry to another day changes that field. Only dates, no time of day.

- `modes` lists the periods the viewer can switch between: `month`, `week` and the rolling `1day` to `6day`; the first is the default.
- `titleField`, `detailFields` (up to 3), `colorField` (a select or reference), `maxEntriesPerDay`, `weekStartsOn` (0 Sunday to 6 Saturday) and `listStart` (`period` or `today`, for the phone list).
- `doneField` shows a completion checkbox on each entry; `sort`, `filter`, `editable`, `editableWhen`, `rowAction` and `recordActions` work as on a table.

```json
{
  "kind": "calendar", "specVersion": 10, "id": "task_calendar", "entity": "task", "revision": 1, "dataSource": "default",
  "dateField": "due", "titleField": "title", "detailFields": ["status"], "colorField": "status",
  "modes": ["month", "week", "3day"], "doneField": "done", "editable": true
}
```

## Board

A **board** shows records as cards in columns, one column per value of a field. `groupBy` lists the fields the viewer may group by (select, boolean or reference; 1 to 5, the first is the default). With `editable`, dragging a card to another column changes that field. With a reference group, `columnsFrom: "options"` builds the columns from the target's records so an empty column is still a drop target.

```json
{
  "kind": "board", "specVersion": 10, "id": "task_board", "entity": "task", "revision": 1, "dataSource": "default",
  "groupBy": [{ "field": "project" }, { "field": "status" }], "titleField": "title", "cardFields": ["due", "points"],
  "doneField": "done", "editable": true, "columnsFrom": "options"
}
```

## Dashboard and widgets

A **dashboard** is tabs of grid items. Each item has a position and size (`x`, `y`, `w`, `h`; the grid has 12 columns unless a tab sets `columns`, up to 24) and one widget. A tab or an item can carry `visibleWhen`, a viewer condition.

The widgets:

- `view` embeds a form, table, calendar or board by id.
- `count` counts the records of a table view, optionally narrowed by a `filter`.
- `stat` computes one number over a table view with a `measure`: `count`, `sum`, `countDistinct`, `min`, `max` or `avg`. A sum or average can take the product of two number fields (`"product": ["points", "points"]`).
- `series` groups a table view by one field and shows one measure per group as a `table`, `bar` or `line` chart. A date field takes a `bucket` of `day`, `week` or `month`. `sort` and `limit` (1 to 200) shape the groups.

```json
{
  "kind": "dashboard", "specVersion": 10, "id": "overview", "title": "Overview", "revision": 1,
  "tabs": [
    { "id": "now", "title": "Now", "items": [
      { "id": "open", "x": 0, "y": 0, "w": 3, "h": 1, "widget": "count", "label": "Open tasks", "view": "tasks", "filter": { "op": "neq", "field": "status", "value": "closed" } },
      { "id": "total", "x": 3, "y": 0, "w": 3, "h": 1, "widget": "stat", "label": "Points", "view": "tasks", "measure": { "op": "sum", "field": "points" } },
      { "id": "by_status", "x": 6, "y": 0, "w": 6, "h": 2, "widget": "series", "label": "Tasks by status", "view": "tasks", "groupBy": { "field": "status" }, "measure": { "op": "count" }, "display": "bar" },
      { "id": "list", "x": 0, "y": 1, "w": 6, "h": 4, "widget": "view", "view": "tasks" }
    ] },
    { "id": "plan", "title": "Plan", "visibleWhen": { "op": "viewerIn", "fact": "role", "values": ["editor"] }, "items": [
      { "id": "calendar", "x": 0, "y": 0, "w": 12, "h": 6, "widget": "view", "view": "task_calendar" }
    ] }
  ]
}
```

The board, form and batch form examples above can be embedded the same way. Views are separate documents, so a dashboard never repeats them; it points at them by id.

## See also

- [ARCHITECTURE.md](../ARCHITECTURE.md), section 6 for the design of each kind and section 7 for validation.
- [records-protocol.md](records-protocol.md) for what the server does with records, actions and pages.
- Design: RFC 0007 (record actions, datetimes, compare, cursor paging), RFC 0008 and 0009 (time, tags, batch, checklists, saved filters, `fieldEqFact`), RFC 0010 (read-only fields, quick filter defaults, page notices).
