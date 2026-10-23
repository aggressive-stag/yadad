# @yadad/testing

Test support for yadad: a mock registry and the registry contract test kit. Use it to test code that renders yadad documents without a real component set, or to prove that your own component set satisfies the `Registry` contract.

```sh
npm install --save-dev @yadad/testing
```

Peer dependencies: React 19, `react-dom`, `vitest` and `jsdom`.

## Mock registry

`mockRegistry` (a `Registry<ReactNode>`) has an unstyled stub component for every field type, layout piece and widget, each with a `data-testid` hook.

```tsx
import { render, screen } from "@testing-library/react";
import { FormRenderer } from "@yadad/renderer";
import { mockRegistry } from "@yadad/testing";

render(<FormRenderer entity={entity} view={form} registry={mockRegistry} dataSources={dataSources} />);
```

## Source states

A screen has states that come from the data source: still loading, failed to load, a save refused, a conflict. `createStateAdapter(seed, options)` returns a `DataAdapter` seeded with a view state's records (from `viewStates` in `@yadad/runtime`) or with a list of records, and puts it in one of them.

```ts
import { createStateAdapter } from "@yadad/testing";

const adapter = createStateAdapter(state, { source: "refused", status: 400, field: "title", message: "Title is taken." });
adapter.configure({ source: "ready" }); // switch while the test runs
```

- `source: "ready"` (default) works like the memory adapter.
- `"loading"`: `find` and `findOne` never settle.
- `"error"`: reads reject with an `Error` carrying `message`.
- `"refused"`: writes throw a `RecordValidationError` with one field error (400, the default, pointing at `field`) or a `ForbiddenError` (`status: 403`).
- `"conflict"`: writes throw a `RecordConflictError` (409) carrying the stored record.

`act` works on every source: the same guard order as the memory adapter (unknown record, then stale `baseVersion`, then the source's refusal), then a no-op — the record comes back unchanged. A confirm dialog and its failure states are testable without a server.

`sourceStates(viewStates(view, documents, { now }), documents)` adds a `source` axis to the view's data states. Every data state stays once with `source: "ready"`; each other source that makes sense for the view (a save can only be refused or conflict where the view writes) gets one state. Each state has `adapter()`, a fresh adapter seeded with its records and put in its source state.

## Check every state of your views

One browser check covers one state. `checkViewStates` from `@yadad/testing/state-checks` renders **every** state of a view (its data states, then the source states above) and reports the ones that break. It needs a DOM and Vitest: use it in a test file with `// @vitest-environment jsdom`.

You pass a `render` function that returns your renderer for the state, so the wiring is one line per view kind. `testing` never imports a renderer itself.

```tsx
// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { validateDocuments } from "@yadad/core";
import { BoardRenderer, CalendarRenderer, DashboardRenderer, FormRenderer, TableRenderer, documentSet } from "@yadad/renderer";
import { mockRegistry } from "@yadad/testing";
import { checkViewStates, problems } from "@yadad/testing/state-checks";
import type { CheckViewStatesOptions } from "@yadad/testing/state-checks";
import { expect, test } from "vitest";

// This page's slice: its entity, its views, at most one viewer — the same documents the real page loads.
const raw: unknown[] = ["task.json", "task_form.json", "task_table.json", "task_board.json", "task_dashboard.json"].map((f) => JSON.parse(readFileSync(`./docs/${f}`, "utf8")));
const checked = validateDocuments(raw); // validate each page's slice, not just the whole pile at boot
if (!checked.ok) throw new Error(checked.errors.map((e) => `${e.document ?? "?"}: ${e.message}`).join("\n"));
const documents = checked.value;
const set = documentSet(documents); // entities + views + viewer by id — what tables, boards, dashboards and row actions need

const render: CheckViewStatesOptions["render"] = (state, { view, entity, registry, dataSources, drafts, now, viewer, omitViewer }) => {
  const who = omitViewer ? {} : { viewer }; // a view that reads viewer facts: pass the state's viewer, or none on the "viewer not provided" state
  switch (view.kind) {
    // A form state's values arrive through the draft store — pass `drafts` or the form renders empty.
    case "form": return <FormRenderer entity={entity!} view={view} registry={registry} dataSources={dataSources} entities={set.entities} documents={set} {...(drafts ? { drafts } : {})} {...who} />;
    case "table": return <TableRenderer entity={entity!} view={view} registry={registry} dataSources={dataSources} entities={set.entities} documents={set} {...who} />;
    // The state names the mode and the day the calendar opens on; key remounts it per state so the seed applies.
    case "calendar": return state.render.kind === "calendar" ? <CalendarRenderer key={state.id} entity={entity!} view={view} registry={registry} dataSources={dataSources} entities={set.entities} documents={set} now={now} initialMode={state.render.mode} initialAnchor={state.render.anchor} {...who} /> : null;
    // The state names the grouping; the viewer can still switch after the state seeds it.
    case "board": return state.render.kind === "board" ? <BoardRenderer key={state.id} entity={entity!} view={view} registry={registry} dataSources={dataSources} entities={set.entities} documents={set} initialGroupBy={state.render.groupBy} {...who} /> : null;
    case "dashboard": return state.render.kind === "dashboard" ? <DashboardRenderer key={state.id} dashboard={view} documents={set} registry={registry} dataSources={dataSources} initialTab={state.render.tab} {...who} /> : null;
  }
};

test.each(["task_form", "task_table", "task_board", "task_dashboard"])("%s, in every state", async (id) => {
  const results = await checkViewStates({ view: id, documents, registry: mockRegistry, now: new Date(2026, 9, 15), render });
  expect(results.length).toBeGreaterThan(0);
  expect(problems(results)).toEqual([]);
});
```

**What state checks don't check.** The checks render your component tree against the mock adapter, so they can't see: which `dataSource` key a view names (every key serves the same seeded adapter — a wrong key renders green here and empty in the app); what a real server serves or refuses (the adapter is seeded, not queried); and anything after a write (saving, actions, optimistic refresh). Cover those with adapter tests against your real data source and end-to-end tests.

`checkViewStates({ view, documents, render, now, registry?, limit?, embeddedLimit?, manyRecords?, skip?, settleMs?, timeoutMs? })` takes the view (or its id) and every document it needs, and returns one `{ id, label, problems }` per state. `render(state, context)` gets the `SourceViewState` and a context with `view`, `entity`, `documents`, `registry` (defaults to the mock registry), `adapter` and `dataSources` (the state's seeded adapter, under every data source key), `drafts` (for a form state: a draft store holding the state's values; pass it to the form), `now`, `viewer` (the state's resolved viewer) and `omitViewer` (true on the "viewer not provided" state: leave the renderer's `viewer` prop out entirely). A dashboard state on a later tab is opened for you by clicking its tab.

Above `limit` the grid is a pairwise cover, not every combination: a green run then proves every *pair* of values appears somewhere, not every state. Ask what it covered with `checkViewStatesReport` — same options, and `checkViewStates` is exactly its `results`:

```tsx
import { checkViewStatesReport, problems } from "@yadad/testing/state-checks";

const report = await checkViewStatesReport({ view: id, documents, registry: myRegistry, now: new Date(2026, 9, 15), render });
expect(problems(report.results)).toEqual([]);
expect(report.complete).toBe(true); // false: limit cut the grid short — this run covered a sample
// report.strategy: "full" | "pairwise" · report.states: how many states rendered (size test timeouts by it)
// report.axes: the ids the grid varied along (data axes, then "source") · report.skipped: states left out on purpose
```

`expectAxes: ["permission", "records", ...]` fails the run when a listed axis is absent from the grid: a view that quietly loses its last editable column loses its `permission` axis — and every locked-record state with it — while staying green, so name the axes the view must cover and let the check catch the refactor. Each missing id adds one `axis-missing` problem (naming the axis and the view) to the first result; `skip: ["axis-missing"]` leaves it out.

Checks per state, each a named problem:

| Check | Fails when |
| --- | --- |
| `render-threw` | `render`, or the first reads settling, throws |
| `console-error` | React or the renderer calls `console.error` |
| `yadad-warning` | the renderer warns with a `yadad:` message (only the renderer's own warnings; others pass through) — pass the render function the **same** `entities` the real page passes, or a reference column warns for its missing target |
| `field-shown-but-hidden` / `field-missing` | a form shows a field whose `visibleWhen` is false, or lacks one whose is true (fields are found by the control `id` ending in `-<fieldId>`, which every `inputId` does) |
| `required-marker` | a field's required marker (`required`, `aria-required` or a `*` in its label) disagrees with `required` and `requiredWhen` |
| `accessible-name` | a button, link, input or other interactive element has no accessible name (axe) |
| `error-message` | a source that fails to load shows no message |
| `group-by-ignored` | a board state is grouped by one field but the rendered board uses another |
| `mode-ignored` / `anchor-ignored` | a calendar state is in one mode, or on one month or week, but the rendered calendar shows another |
| `viewer-visibility` | a dashboard tab or table column is shown, or missing, against what the state's viewer may see |
| `editable-offered` | an inline edit, move or open handler is offered where the viewer condition is false or the record is locked |
| `editable-missing` | the reverse: it is withheld where the viewer may use it |
| `action-offered` | a table, calendar or board offers a record action the state withholds (`can.actions` false or `visibleWhen` false) |
| `action-missing` | the reverse: an action `availableActions` allows is not offered |
| `diff-offered` | a text column's Display was given a `diff` although the column does not compare |
| `diff-missing` | a comparing column's Display got no `diff` while its comparator is present |
| `axis-missing` | an id in `expectAxes` is absent from the grid (added to the first result, not per state) |

`problems(results)` flattens the results into one line per problem, `"<state label> [<state id>]: <check>: <message>"`, so a failing `expect(problems(...)).toEqual([])` lists every failing state. Pass `timeZone` to have generated `datetime` values rendered in a zone other than UTC (it goes to `viewStates`; a datetime quick-filter state then compares against 09:30 in that zone). `skip: ["accessible-name"]` leaves a check out. `limit` caps the data states (24 by default); lower `manyRecords` to keep the "many records" states fast.

## Contract kit

Import it from `@yadad/testing/contract-kit` in a Vitest file. For every field type, the kit checks that your component renders with fixture options, emits the right JSON type on change, shows an error it is given, and passes axe; the layout components get their own checks.

```tsx
import { describeRegistryContract } from "@yadad/testing/contract-kit";
import { myRegistry } from "./registry";

describeRegistryContract(myRegistry);
```

- `registryContractChecks(registry, samples?)` returns the checks as `{ name, run() }` objects, for use outside Vitest. Run them one at a time.
- `defaultSamples` is the fixture per field type; pass your own `FieldSamples` to override them.
- The `layout.Calendar`, `layout.Board` and `layout.Dialog` keys, the `widgets.series` key and the `fields.datetime` key are optional, so their checks only run when the registry has them. `layout.Dialog` is checked for the modal behaviour RFC 0007 needs: named by its label, focus taken on open and returned on close, Escape closes. `fields.datetime` is checked for a `<time>` element whose `dateTime` is the stored instant, showing the formatted `text` it was given. `widgets.series` is checked the way a chart must be: reachable by its label as an accessible name, every group's label and formatted text present as text in the accessible tree (an SVG of bars is decoration, not data), the `measureLabel` shown, and no throwing or self-unmounting on `groups: []` or a gap bucket whose `value` is undefined. The mock registry ships all of them (a plain board with a "Move to…" action and no drag, a datetime input over `datetime-local`, a minimal dialog, a series as a plain table of groups) and passes the kit.

See the [repo README](../README.md) and [ARCHITECTURE.md](../ARCHITECTURE.md).
