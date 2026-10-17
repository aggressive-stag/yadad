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

## Logic

- `evaluateCondition(condition, values, now?, viewer?)`, `evaluateFormRules(view, values, viewer?)` and `applyFormRules(entity, view, values, viewer?)`: visibility and required-ness. Hidden fields keep their values unless the item sets `clearWhenHidden`. Relative dates (`{ daysFromToday: n }`) resolve to local `"YYYY-MM-DD"` before evaluation and before any adapter call.
- `resolveViewer(viewerDocument, [{ fact, value }])` builds the `ResolvedViewer` the renderers take: every declared fact once, the host's value when valid and the declared default otherwise, with `issues` for what it ignored. `evaluateViewerCondition`, `visibleColumns`, `columnEditable`, `viewEditable`, `rowActionVisible`, `visibleTabs`, `visibleItems` and `canUpdate` answer what a viewer may see and do; `findViewerDocument` and `viewerFactsRead` find the facts a set declares and a view reads. A `viewerIn` leaf is false without a viewer.
- `validateRecord(entity, values)`: record validation against the entity's field rules.
- `submitForm(entity, values, adapter)` and `submitEdit(entity, record, patch, adapter)`: validate, then write.
- `applyPatch(doc, operations)`: JSON Patch against a document.

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

The view kind adds axes: forms a `fill` axis (other fields empty or filled); tables, calendars and boards a `records` axis (none; one; one with every optional value empty; one with long text; many, which is one more than the page size or than the calendar's or board's cap); calendars a `mode` axis and records on the first and last visible day; boards a `group` axis with each `groupBy` field; dashboards a `tab` axis and one axis per embedded view.

A view that reads viewer facts (a `viewerIn` leaf in it, in the views it embeds or in the views its row actions open) gets one axis per fact, `viewer:<factId>`: a select fact takes the values the conditions name plus one value none names (the default if it is unnamed), a boolean takes true and false. Facts nothing reads are not axes and take their default. A view with an edit surface (an editable table column, calendar or board, or a dashboard embedding one) gets a `permission` axis, `unrestricted` or `record-locked`; in the latter the first record carries `can: { update: false }`. Each state has a `viewer` (a `ResolvedViewer`), and a view that reads a fact gets one extra state, `viewer-not-provided`, with `omitViewer: true`: render it without the `viewer` prop and it must look like the state of all defaults. That state counts towards `limit`.

States are all combinations of the axes when they fit in `limit` (default 24), otherwise a deterministic pairwise cover: every pair of values from two axes appears in at least one state. `complete` is false when `limit` was too small even for that. A state that cannot be built (for example a record that would not validate) is left out and listed under `skipped` with a reason. `combineAxes(axes, limit)` is the generic combiner, exported for your own axes.

## Drafts

`createDraftStore(storage)` keeps unsaved form input so a reload or navigation does not lose it. `storage` is anything with `getItem`, `setItem` and `removeItem`, so `localStorage` works as-is. Entries live under `yadad:draft:<formViewId>:<recordId or "new">` (change the prefix with the second argument). Storage errors are swallowed; a draft never breaks a form.

```ts
import { createDraftStore } from "@yadad/runtime";
const drafts = createDraftStore(window.localStorage);
```

When a draft is loaded, `restoreDraft(entity, draft)` fits it to the entity as it is now: values for fields the entity no longer has are dropped (and listed in `droppedFields`), `revisionChanged` says the entity revision moved since the draft was taken, and it returns `null` if nothing is left to restore. The renderer uses this for its `drafts` option.
