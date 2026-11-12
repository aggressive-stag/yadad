# Building an app on yadad: a guide for coding agents

This file is for an agent working in an app that installed `@yadad/*`. It is not for changing yadad itself. Point your own `AGENTS.md` at it.

## What yadad is

- yadad builds screens from small JSON documents: entities (the data model) and views (form, table, calendar, board, dashboard), plus one optional viewer document.
- You write documents and a few lines of host code. You do not write the screens.
- `@yadad/core` validates the documents. `@yadad/runtime` holds headless logic and data adapters. `@yadad/renderer` draws them with React. `@yadad/testing` checks them.
- The documents are the contract. If a behaviour is not a key in the contract, it is not available through documents.
- The renderers never import components. The host passes a `registry` (a component set) and a `dataSources` map of adapters.

## Order of work

1. Entities first: one per kind of record, with its fields (`text`, `number`, `boolean`, `select`, `date`, `datetime`, `reference`, `time`, `tags`).
2. Views next: a form to create, a table to list, optionally a calendar or board over the same entity.
3. A dashboard if you want several views on one page.
4. A viewer document last, only if what a person sees depends on who they are.
5. Validate after each step. Do not write all documents and validate once.

## Learn the contract of the installed version

Do not guess keys. Ask the installed package:

```sh
node -e "import('@yadad/core').then((m) => console.log(JSON.stringify(m.describeContract(), null, 1)))"
```

It lists every document kind and its keys, field types, condition operators, where each condition may appear, widgets, measures and limits. A key that is not in it does not exist in your version. Examples of every kind are in the yadad repository at `docs/reference.md`.

## Validate

```ts
import { migrate, validateDocument, validateDocuments } from "@yadad/core";

const result = validateDocuments(docs.map((d) => migrate(d)));
if (!result.ok) for (const e of result.errors) console.log(e.document, e.path, e.code, e.message, e.hint);
```

- Run `validateDocuments` on the whole set. It also checks references between documents (a view's entity, a column's field, a dashboard's views). `validateDocument` checks one document's shape only.
- Every error has `path` (a JSON Pointer), `code`, `message` and `hint`. Read the hint: it names the allowed keys or values.
- Warnings are in `result.warnings` with the same shape. Fix them too.
- Check every state of every view: `checkViewStates` from `@yadad/testing/state-checks`, in a Vitest test with jsdom, using `mockRegistry` or your own registry. It renders the empty, full, loading, failed, refused and viewer states and names each problem.
- Validate records on the server with `recordJsonSchema(entity)` from `@yadad/core`. The HTTP protocol a backend implements is in the yadad repository at `docs/records-protocol.md`.

## What the contract refuses, and what to do instead

| You might try | What you get | Do this |
| --- | --- | --- |
| A new field type, such as `"type": "money"` | `unknown-field-type`: "Unknown field type" and the list of types | Use `number` with `unit`, or `text`. A new type needs a change to yadad (an RFC), not host code |
| A string expression: `"filter": "a == 'x'"` | `type`: "A condition must be a JSON object." | Use a condition tree: `{ "op": "eq", "field": "a", "value": "x" }` |
| An extra key (an icon, a props bag, a class name) | `unknown-property`, with the allowed keys in the hint | Remove it. Style and extras belong in the component set or in host code around the renderer |
| A viewer-dependent filter: a `viewerIn` condition in `filter` | `invalid-value`: "A filter cannot depend on the viewer." | Scope the records on the server, or hide the view with a viewer condition (`visibleWhen`) |
| A relative date on a `datetime` field: `{ "daysFromToday": -1 }` | `invalid-value`: a relative date can only be compared with a date field | Use a `date` field, or an absolute instant |
| `viewerIn` with no viewer document | `unknown-reference`: "No viewer document declares viewer facts." | Add a document of kind `viewer` that declares the fact |
| A view that names a missing entity, or a column that names a missing field | `unknown-reference`: "View references unknown entity" or "Field is not on entity" | Fix the id. Entity ids come from the entity documents in the same set; field ids from that entity |

## Common mistakes from real apps

1. **A server-generated id marked `required`.** Every create then fails with "<Label> is required." because the form cannot supply it. Mark it `"readOnly": true`: it is shown, never sent back, and a create does not need it.
2. **Fields the server does not serve or accept.** A document that declares a field the records API refuses answers `400 unknown-property` only at runtime. Keep entity fields and the server's fields identical, and check them with `recordJsonSchema`.
3. **An inline edit of a table row does nothing.** The client validates the whole record before it sends anything. A stored record that no longer fits the entity (a field that became required, a select value that left the options) cannot be saved until that field is fixed. The error shows in the row.
4. **A relative date against a `datetime`.** See above: use `date`, or compare with an instant.
5. **Counts and totals over a server that sends no `total`.** A count widget reads pages up to 5,000 records and then says "5000+". A server that refuses `limit=0` makes the count fail to load. Make `limit=0` legal on the server.
6. **No theme CSS.** Components read `--yadad-*` variables. Without the theme's CSS (`themeToCss` from `@yadad/theme`, or the component set's own stylesheet) the page renders unstyled and nothing reports it.
7. **A select colour that is not in the palette.** It is a warning, and it paints nothing. Use one of the eight palette colours the hint lists.
8. **A peer version mismatch in tests.** `@yadad/testing` has peers on `react`, `react-dom`, `vitest` and `jsdom` (`~30.1.1`). Install versions inside those ranges, or the lockfile drifts and the suite breaks.
9. **A select or filter that needs server data.** Select options are part of the document. Put the values in at build time and validate after, or use a `reference` field to point at server records.
10. **Drafts left on a shared browser.** Pass `{ scope: <user id> }` to `createDraftStore` and call `clearDrafts` on sign-out.

## Host code

- A `dataSource` in a document is a key. The host maps it to a `DataAdapter` in the `dataSources` map: `createMemoryAdapter()` for tests and demos, `createHttpAdapter(...)` for a server that follows the records protocol. Never put a URL in a document.
- A form only creates records. A table edits records in place (an editable column), and a record can run actions (`recordActions`).
- Anything the documents cannot say (navigation, layout around the views, auth) is host code around the renderers. Do not wrap a renderer to change what a document means; if the contract is missing something, write it down as a proposal for yadad.

## Where things are

- `node_modules/@yadad/core/README.md`, and the other packages' READMEs, for the API of each package.
- The yadad repository: `docs/reference.md` (document examples), `docs/records-protocol.md` (the server protocol), `ARCHITECTURE.md` (design), `rfcs/` (proposals).
