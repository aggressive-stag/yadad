# HTTP records protocol

How a host's backend serves records to yadad's HTTP `DataAdapter`. The adapter (`createHttpAdapter` in `@yadad/runtime`) speaks this protocol and nothing else; a backend that implements it gets tables, forms, calendars, boards and dashboards without writing UI code.

It is in flux like the documents (no freeze is planned): a change here is a change for both sides, and ships with a release of `@yadad/runtime`.

## Basics

- **Base URL** is host configuration (e.g. `/api/records`), never part of a document. `{entity}` is an entity document's `id`.
- **Same origin.** The adapter calls `fetch` with `credentials: "same-origin"` by default, so session cookies just work. No CORS is assumed.
- **JSON** request and response bodies, `Content-Type: application/json`.
- **Ids are opaque strings.** The server picks them; the client never parses or builds one. An id is never reused for a different record, even after a delete. A server whose ids follow position (and so can shift when a record is removed) must instead require `baseVersion` on every update and delete, so a stale id conflicts rather than hitting another record.
- **Field values** are `string | number | boolean | readonly string[] | null`. Dates are `"YYYY-MM-DD"` strings, times are `"HH:MM"` strings (RFC 0008 item 14), and a `tags` field (RFC 0008 item 15) is the one type whose value is an array: a list of non-empty strings in the order entered — the server refuses a blank element (`400` at `/values/<field>`) and may trim or dedupe the rest on write; the client must tolerate that, and the display shows the list as the record holds it, repeats included. `null` means empty — for tags, so does an empty array.

## Record

```jsonc
{
  "id": "s12.0.2",               // opaque string
  "entityId": "set",             // entity document id
  "entityRevision": 3,           // entity revision the record was last saved under
  "version": "2026-10-05T18:22:07.123Z", // opaque; changes on every write to the record
  "values": { "weight": 100, "reps": 5 },
  "can": { "update": false }     // optional: what the current viewer may do with this record
}
```

- `can` is optional and states what the viewer making the request may do with this record: `{ "update"?: boolean, "delete"?: boolean, "actions"?: { [actionId]: boolean }, "fields"?: { [fieldId]: boolean } }`. A missing `can`, or a missing key in it, means "not stated": the client offers the action and the server decides, so servers that do not implement it change nothing. It only restricts: `"update": true` enables nothing the document does not already offer. It is a read-time snapshot for this viewer, may change without `version` changing, and is never cached across reloads or sent back: a request body never carries `can`, and a server ignores it if sent. It appears on every Record the server returns (list items, `GET`, `POST`/`PATCH`/batch responses, the `current` record of a `409`). The server still enforces: a refused write is a `403`; the client puts the edit or the moved card back, shows the response's message and reloads, which refreshes `can`. A client treats a malformed `can` (not an object, a non-boolean, an unknown key) as absent.
- `can.fields` (RFC 0008 item 9) narrows `"update"` per field: an object from field id to boolean, same rules as `actions` — only `false` restricts, a missing key means "not stated", and a malformed one drops the whole `can`. It answers "may this viewer write *this field* of this record", which is per-record data the document cannot carry (a card assignee, a row owner). The client consults it where the document offers a per-field write: inline edit of a table cell, dragging a board card across the column field, dragging a calendar entry between days. It never enables: `update: false` — or a refused write — wins whatever `fields` says. A server that never sends it changes nothing (fail-open, the server decides on write, as with the rest of `can`).
- `entityRevision` is a schema stamp, not concurrency control: old records are upcast on read. A write carries the revision the client built its `values` against, and the server stamps it on the saved record. A server never rejects a write because the request's `entityRevision` is older or newer than its own current one: it judges the `values` by its own rules, so a field it does not know is a `400` (unknown field) and everything else is accepted. The stamp is the only thing the revision changes.
- `version` is concurrency control. The client sends it back as `baseVersion` on writes; the server rejects the write if the record changed since. It must change on every write that changes the record, so two writes close together never share one. Its format is the server's business (a counter, a hash, or a timestamp fine-grained enough for that). Several records may share a version if the server stores them together; a write to any of them changes all of their versions.

## Validating records on the server

Do not re-implement the field rules. Generate a JSON Schema (draft 2020-12) from the entity document and validate each write's `values` against it. In JavaScript, `recordJsonSchema(entity)` from `@yadad/core` returns it. Without JavaScript in the backend's runtime, generate the files at build time from the repository:

```sh
node tools/record-schema.ts entities/set.json > schemas/set.schema.json   # or: pnpm record-schema entities/set.json
```

Then, for example in Python with `jsonschema` (install `jsonschema[format]` for the `date` format check):

```python
import json
from jsonschema import Draft202012Validator, FormatChecker
validator = Draft202012Validator(json.load(open("schemas/set.schema.json")), format_checker=FormatChecker())
errors = list(validator.iter_errors(request_values))  # empty list means valid
```

Regenerate the schema whenever the entity changes revision.

What the schema says: one property per field; `additionalProperties: false` (unknown field); `required` lists required fields; optional fields also accept `null`; a required boolean must be `true`; a required text or reference field must not be blank; a select is an `enum`; a number has `minimum`/`maximum`; a date is a `YYYY-MM-DD` string within `min`/`max`; a tags field is an array of strings with `uniqueItems`, each element `pattern: "\\S"`, plus `minItems: 1` when the field is required (`minItems: 0` otherwise).

### Server-set fields (`readOnly`)

A field marked `"readOnly": true` is set by the server (an id, a created-at). Reads carry it in `values`. Writes must not send it: `validateRecord` refuses it ("<label> is set by the server"), and `recordJsonSchema(entity, { mode: "write" })` leaves it out of `properties` and `required`, so its `additionalProperties: false` rejects a write that sends one. Validate create and update bodies with the write schema; the default (stored) schema describes what a read returns. `required` together with `readOnly` is allowed: stored records must have the value, but it is never a form requirement.

### Where the schema and `validateRecord` differ

`validateRecord` (the browser check) is checked against the schema by a parity test that fails when one changes without the other. These cases are the known, deliberate differences:

- **Blank strings.** `validateRecord` treats `""` and whitespace-only strings as empty for every field type. The protocol says empty is `null`, so the schema rejects `""` for number, boolean, select and date fields (text and reference fields are strings, so an optional one accepts it). A server should reject them too.
- **Step.** JSON Schema `multipleOf` counts from zero and divides in floating point. The schema emits it only when that is exact (the step is a binary fraction such as 1, 0.5 or 0.25, and `min` is a multiple of it). Otherwise (a step like 0.1, or a `min` that is not a multiple of the step) the rule is only described in the field's `description` and the server must check it itself, counting steps from `min`. Even when emitted, `validateRecord` forgives a float error of 1e-9 that `multipleOf` does not.
- **Calendar dates.** The schema checks the `YYYY-MM-DD` shape and the `min`/`max` range exactly (as patterns), but `2026-02-30` is rejected only by a validator that asserts the `date` format (most do, when format checking is enabled).
- **Time step.** A `time` field's `step` (whole minutes, RFC 0008 item 14) has no JSON Schema keyword, so the schema checks the `HH:MM` shape and the `min`/`max` range only and `validateRecord` is the step gate. A server must check it itself.
- **Text length.** A `text` field's `maxLength` (RFC 0008 item 13c) is enforced by `validateRecord` (counting characters as code points), on record forms and on action input alike. `recordJsonSchema` carries it as `maxLength` on the property (JSON Schema also counts code points), so a server validating with the schema refuses what the client refuses.
- **Tag duplicates.** The schema says `uniqueItems`; `validateRecord` leaves repeats to the input (the chips widget prevents them), so `["a", "a"]` passes the browser check and a server should reject it.

## Endpoints

| Method and path | Body | Success |
| --- | --- | --- |
| `GET {base}/{entity}?filter=&sort=&offset=&limit=` (or `cursor=` instead of `offset=`) | — | `200 { "items": Record[], "total"?: number, "next"?: string \| null }` |
| `GET {base}/{entity}/{id}` | — | `200 Record` |
| `POST {base}/{entity}` | `{ "values", "entityRevision" }` | `201 Record` |
| `PATCH {base}/{entity}/{id}` | `{ "values", "entityRevision", "baseVersion" }` | `200 Record` |
| `DELETE {base}/{entity}/{id}?baseVersion=` | — | `204` |
| `POST {base}/{entity}/_batch` | see below | `200 { "created": Record[], "deleted": string[] }` |
| `POST {base}/{entity}/{id}/actions/{action}` | `{ "input"?, "entityRevision", "baseVersion" }` | `200 Record`, or `204` when the action removed the record |

`{id}` is URL-encoded. Ids never start with `_`, so `_batch` cannot collide with one.

### Listing

- `filter`: a URL-encoded JSON condition, exactly the `Condition` AST from `@yadad/core` (ops `eq neq gt gte lt lte in contains empty notEmpty and or not`). Optional.
- `sort`: URL-encoded JSON array of `{ "field", "dir": "asc" | "desc" }`, first key first. Empty values sort last in both directions. Optional; without it the order is the server's choice but stable.
- `offset` (default 0, minimum 0) and `limit` (default 50, minimum 0, maximum 500). `limit=0` is legal: `items` is empty and `total` is still the real count (a count widget uses this). A `limit` above 500, a negative or non-integer `offset` or `limit` is a `400`.
- `total` counts every record matching `filter`, ignoring `offset` and `limit`. It is optional: a server that does not count leaves it out.
- `cursor` is an alternative to `offset` for servers that page without counting: the opaque `next` of the previous response, which the client passes back and never parses. Sending both `cursor` and `offset` is a `400`. `next` is `null` or absent on the last page. A response with neither `total` nor `next` has no way to say "there is more", so the client treats it as the last page. `limit=0` is a count request and needs `total`.

Relative dates never reach the server. A `{ "daysFromToday": N }` value is resolved by the runtime to a concrete `YYYY-MM-DD` date on every load, before the filter goes to the `DataAdapter`, so the server receives only concrete dates. A `{ "hoursFromNow": N }` value (a `datetime` field, whole hours, negative is the past) is resolved the same way to the stored `...Z` instant, so the server receives only concrete instants. A server that also accepts the `daysFromToday` leaf directly should validate it like any other value, and answer `400` rather than `500` when it does not support it.

The server must translate conditions by whitelist: every op and field id is checked against what it knows and mapped to its storage. It never builds a query from strings in the request. An unknown op or field is a `400`. `viewerIn` is a condition op for documents, not for the wire: the client adapters refuse a filter that contains one, and a server treats it as an unknown op (`400`). Scoping records to the signed-in user belongs on the server.

There is no cross-field search box in the protocol (RFC 0009 item 6, deferred by the owner): a host that wants one keeps translating its own box into `Query.filter`, and a second consumer asking for the same box promotes it to a micro-RFC against that item.

### Union lists are read-only host entities

A view names exactly one `entity`, so a single list over two entities — tasks *and* occurrences in one paged, sorted table — is not a document feature. It is a data source feature (RFC 0009 item 2, ratified): the host exposes the combined list as a **read-only entity** whose adapter serves the union from shared storage, and the document knows nothing about it — one document, one entity, every validator unchanged. This is the production pattern already proven by the todo app's `completion` entity. Such an entity declares no write surface the host cannot honor: reads, filters and sorts are the union's; a write is the host's choice, refused (`403`) when the underlying record's own rules do not allow it. An in-contract union (a document naming N entities and a column mapping) stays closed until a second consumer proves this pattern insufficient.

### Select options that live on the server are filled at build time

A select field's `options.values` is part of the document and of its validation: `validateRecord` checks a stored value against it, `recordJsonSchema` emits it as an `enum`, and the state grid and board columns read it. A list that lives on the server (RFC 0010 item 3, ratified) is therefore filled into the document at host build time, and the filled document is validated like any other. The committed document may carry a placeholder only if the host's loader replaces it before validation runs. A dynamic option source is not part of the contract. To point at server records in-contract, use a `reference` field, which the data source already serves.

### Membership rows are records; authorization is not

Access *control* is the server's alone and stays out of documents — `can` is server output by design (RFC 0006), and no document verb says "who may see". Membership *rows* are ordinary records (RFC 0009 item 7, ratified): a `member` entity with reference fields (`list`, `person`) served like any other entity, shown as a table, edited with the verbs that already exist. "Leave this list" is a record action on the member's own row, whose server-side check enforces "only that member (or the owner)". A `403` from that check is the answer; the boundary stands for permissions and never excluded rows about people.

### Writes

- **Create:** `values` holds the fields to set. Omitted fields are empty.
- **Update:** `values` is a partial patch. An omitted field is unchanged, an explicit `null` clears it. `baseVersion` is required. An empty `values` is a no-op: `200` with the current record and its version unchanged (a stale `baseVersion` is still a `409`). The client skips the request when nothing changed, but servers must accept it.
- **Delete:** `baseVersion` is optional. When present, the server rejects the delete with `409` if the record changed since. Clients send it whenever they have it.
- **Stale and invalid at once:** check `baseVersion` first. A write whose `baseVersion` is stale is a `409`, even if its `values` are also invalid: the values were built against a record that has since changed, so judging them is meaningless, and the `current` record in the `409` is what the client needs to merge and resubmit. Only a write with a current `baseVersion` gets a `400` for bad values. (The client validates before sending, so a `400` on a fresh write means the server's rules are stricter.)
- An unknown field id in `values` is a `400`, never silently dropped.
- The server validates values against its own rules and may be stricter than the entity document (for example, a date that must be near the server's today). The server is the authority on "today".

### Batch

```jsonc
// request
{
  "entityRevision": 3,
  "create": [ { "values": { ... } }, ... ],        // optional
  "delete": [ { "id": "s12.0.2", "baseVersion": "..." }, ... ] // optional; baseVersion optional per item
}
```

All or nothing: if any item fails, nothing is written and the response is the error for the first failing item. Its `path` is a JSON Pointer into the batch *request body* above, not into a record: the third `create` item's `reps` value is `/create/2/values/reps`, and a stale second `delete` is `/delete/1` (with `409`). Deletes run before creates.

## Errors

Every non-2xx response has the same body shape as document errors in `@yadad/core`:

```jsonc
{ "errors": [ { "path": "/values/reps", "code": "invalid-value", "message": "Reps must be at least 1.", "hint": "Enter 1 or more." } ] }
```

- `path` is a JSON Pointer into the request body (`""` for the request as a whole, `/filter/...` for a bad filter in the query string).
- `code` is one of `type`, `required`, `unknown-property`, `invalid-value`, `not-found`, `conflict`, `unauthorized`, `forbidden`.
- `message` is for a person; `hint` says what to change.

| Status | When | Body extras |
| --- | --- | --- |
| `400` | Bad filter, sort, paging, unknown field, invalid value | — |
| `401` | Not signed in | — |
| `403` | Signed in but not allowed, e.g. a write to a record whose `can` says `false` | — |
| `404` | Unknown entity, or no such record for this user (another user's record is also a `404`) | — |
| `409` | `baseVersion` is stale | `"current": Record` (or `null` if it was deleted) so the client can show or merge it |

### Actions

`POST {base}/{entity}/{id}/actions/{action}` runs a command the entity declares (its `actions`). `{action}` is an action id.

```json
{ "input": { "reason": "duplicate of s4" }, "entityRevision": 3, "baseVersion": "7" }
```

- `input` holds the declared input fields' values; absent or `{}` when there are none. An unknown input id is a `400` at `/input/<field>`.
- `baseVersion` is required and is checked first: a stale action is a `409` with `"current"`, even if `input` is also invalid. `entityRevision` is a schema stamp, as on writes.
- `200 Record` is the record after the action, with its new `can`. `204` means the action removed the record.
- `403` the viewer may not run it (or `can.actions` said so); `404` unknown entity, record or action; `409` stale **or** no longer applicable (the message says why, `current` is the record now). A client reloads on both and does not retry.
- `can.actions` is an object from action id to boolean; only `false` restricts, and a malformed one is dropped as a whole, like the rest of `can`.
- To guard an action by more than the record's own change, make `version` cover that other state (several records may share a version when stored together).
- **Datetimes in `input`** travel in the one stored form, exactly as a `datetime` field's value does — see "Datetimes on the wire" below. An input of type `datetime` whose value is not canonical is a `400` at `/input/<field>`, like any other invalid value.

The adapter turns these into typed errors; it does not retry writes on its own.

## Datetimes on the wire

A `datetime` field's value is an instant, and it travels in exactly one form: `YYYY-MM-DDTHH:MM:SS.sssZ` — UTC, always three fractional digits, always the trailing `Z` (what `Date.prototype.toISOString` prints). One form means string order is time order, so every adapter, the in-memory sort and a SQL `ORDER BY` agree without parsing.

- A server holding finer precision truncates to milliseconds on the wire.
- An offset (`+02:00`), a missing `Z`, other precision or a calendar-invalid value (`2026-02-30T00:00:00.000Z`) is `invalid-value` with a hint that shows the form. `null` is empty.
- `min` and `max` properties are canonical instants, like a `date`'s. `recordJsonSchema` emits `format: "date-time"` plus a `pattern` for the canonical form; the exact range check and the calendar-validity check are stated in the field's `description` and enforced by `validateRecord`, as with `date` (see "Where the schema and `validateRecord` differ").
- Conditions on a `datetime` take `eq neq gt gte lt lte in empty notEmpty` — never `contains` — with a canonical instant as the value.
- Everything human-facing is the viewer's business, not the wire's: the renderer formats with `formatDateTime` in the viewer's zone and locale, and the quick filter converts a from/to range typed in the viewer's zone to instants (the from is the start of its minute, the to the last millisecond of its minute, so 10:00–10:30 includes 10:30:59.999).

## Paging without a total

`total` is optional and a continuation token is available, so a server that never counts can still page (see "Listing" for the parameters):

- `{ "items": Record[], "total"?: number, "next"?: string | null }`. A server may return `total` (as the counting adapters do), `next` alone (cursor only), or both. A response with neither has no way to say "there is more", so the client treats it as the last page.
- `next` is **opaque**: the client passes it back untouched as `cursor` and never parses it. `null` or absent means the end.
- The client's rule: no `total` and a `next` switches it to cursors, and it keeps a stack of the cursors it visited so Previous works without the server supporting backward cursors; the pager shows "Page 2" with no "of N". Changing the sort, a quick filter or the page size clears the stack.
- The table never "loads more": appending rows without bound changes where focus goes, so the client keeps Previous and Next on both paths.
- `notice` (optional): the server's statement about this one answer, `{ "tone": "info" | "warning", "text": string }`, for example `{ "tone": "warning", "text": "Served without vector search" }`. `text` is plain text, never markup, and is not empty. It is per response and never cached or sent back, and it changes no record. A client drops a malformed `notice` (wrong tone, non-string or empty text, extra keys) with a console warning and shows the page without it.
- `limit=0` is the count request and needs `total`. A count widget against a counting-free server walks pages up to the 5,000-record cap and shows what it read, or "5000+" when the cap was hit with more pending.
- `cursor` and `offset` together is a `400`.

## Examples

Compact request and response pairs for each endpoint, for an entity `set` (fields `weight`, `reps`, `day`, `notes`; `notes` is a text field).

**List with filter and sort.** `filter` is `{"op":"gte","field":"weight","value":100}` and `sort` is `[{"field":"day","dir":"desc"}]`, URL-encoded:

```
GET /api/records/set?filter=%7B%22op%22%3A%22gte%22%2C%22field%22%3A%22weight%22%2C%22value%22%3A100%7D&sort=%5B%7B%22field%22%3A%22day%22%2C%22dir%22%3A%22desc%22%7D%5D&offset=0&limit=2

200 { "items": [ { "id": "s12", "entityId": "set", "entityRevision": 3, "version": "7", "values": { "weight": 100, "reps": 5, "day": "2026-10-05" } } ], "total": 1 }
```

**List with per-record permissions.** The second record is locked for this user, so the server states `can` on it (the first states nothing):

```
GET /api/records/set?limit=2

200 { "items": [
  { "id": "s12", "entityId": "set", "entityRevision": 3, "version": "7", "values": { "weight": 100, "reps": 5, "day": "2026-10-05" } },
  { "id": "s14", "entityId": "set", "entityRevision": 3, "version": "2", "values": { "weight": 90, "reps": 8, "day": "2026-10-07" }, "can": { "update": false, "delete": false } }
], "total": 2 }

PATCH /api/records/set/s14
{ "values": { "reps": 9 }, "entityRevision": 3, "baseVersion": "2" }

403 { "errors": [ { "path": "", "code": "forbidden", "message": "You are not allowed to update this record.", "hint": "Ask the owner." } ] }
```

A filter never carries a viewer: the client refuses a `viewerIn` condition in a filter before it sends a request, so the server never has to parse one. Who is asking comes from the server's own session, and `can` is how it tells the client.

**Count only** (`limit=0`): `GET /api/records/set?limit=0` returns `200 { "items": [], "total": 41 }`.

**Cursor paging** (a server that does not count; the first request has no `cursor`): `GET /api/records/set?limit=2` returns `200 { "items": [ …2 records… ], "next": "9f3a" }`, then `GET /api/records/set?limit=2&cursor=9f3a` returns the following two, and the last page answers `"next": null` (or leaves `next` out). No `total` appears anywhere; the client passes `next` back untouched as `cursor`.

**Get:**

```
GET /api/records/set/s12

200 { "id": "s12", "entityId": "set", "entityRevision": 3, "version": "7", "values": { "weight": 100, "reps": 5, "day": "2026-10-05" } }
```

**Create:**

```
POST /api/records/set
{ "values": { "weight": 105, "reps": 3, "day": "2026-10-06" }, "entityRevision": 3 }

201 { "id": "s13", "entityId": "set", "entityRevision": 3, "version": "1", "values": { "weight": 105, "reps": 3, "day": "2026-10-06" } }
```

**Patch** (only `reps` changes):

```
PATCH /api/records/set/s12
{ "values": { "reps": 6 }, "entityRevision": 3, "baseVersion": "7" }

200 { "id": "s12", "entityId": "set", "entityRevision": 3, "version": "8", "values": { "weight": 100, "reps": 6, "day": "2026-10-05" } }
```

**Delete:**

```
DELETE /api/records/set/s12?baseVersion=8

204
```

**Batch** (delete one, create one):

```
POST /api/records/set/_batch
{ "entityRevision": 3, "delete": [ { "id": "s12", "baseVersion": "8" } ], "create": [ { "values": { "weight": 110, "reps": 2, "day": "2026-10-07" } } ] }

200 { "created": [ { "id": "s14", "entityId": "set", "entityRevision": 3, "version": "1", "values": { "weight": 110, "reps": 2, "day": "2026-10-07" } } ], "deleted": [ "s12" ] }
```

**Action, allowed** (the entity declares `archive`, which removes the record):

```
POST /api/records/set/s12/actions/archive
{ "entityRevision": 3, "baseVersion": "8" }

204
```

**Action, kept** (the entity declares `note`, whose input is one text field; the record comes back with its new `can` — the server says the viewer may not run `note` a second time):

```
POST /api/records/set/s12/actions/note
{ "input": { "notes": "personal record" }, "entityRevision": 3, "baseVersion": "8" }

200 { "id": "s12", "entityId": "set", "entityRevision": 3, "version": "9", "values": { "weight": 100, "reps": 6, "day": "2026-10-05", "notes": "personal record" }, "can": { "actions": { "note": false } } }
```

**Action, not allowed** (the viewer may not run it, or `can.actions` said so — this is the same request whose `200` is just above, sent after that response; the `200` carried `"can": { "actions": { "note": false } }`):

```
POST /api/records/set/s12/actions/note
{ "input": { "notes": "personal record" }, "entityRevision": 3, "baseVersion": "9" }

403 { "errors": [ { "path": "", "code": "forbidden", "message": "You are not allowed to run this action.", "hint": "Ask the owner." } ] }
```

**Action, stale** (`baseVersion` is checked before `input`, so a stale action with invalid input is still this; the `409` for "no longer applicable" looks the same and the client reloads on both):

```
POST /api/records/set/s12/actions/note
{ "input": { "notes": "personal record" }, "entityRevision": 3, "baseVersion": "8" }

409 { "errors": [ { "path": "/baseVersion", "code": "conflict", "message": "This set was changed since you loaded it.", "hint": "Reload it and try again." } ],
      "current": { "id": "s12", "entityId": "set", "entityRevision": 3, "version": "9", "values": { "weight": 100, "reps": 6, "day": "2026-10-05", "notes": "personal record" } } }
```

**400, invalid value** (here in a batch, so `path` points into that request body):

```
POST /api/records/set/_batch
{ "entityRevision": 3, "create": [ { "values": { "weight": 100, "reps": 5 } }, { "values": { "weight": 100, "reps": 0 } } ] }

400 { "errors": [ { "path": "/create/1/values/reps", "code": "invalid-value", "message": "Reps must be at least 1.", "hint": "Enter 1 or more." } ] }
```

**409, stale `baseVersion`** (the record is at version `8`, the client still holds `7`):

```
PATCH /api/records/set/s12
{ "values": { "reps": 7 }, "entityRevision": 3, "baseVersion": "7" }

409 { "errors": [ { "path": "/baseVersion", "code": "conflict", "message": "This set was changed since you loaded it.", "hint": "Reload it and try again." } ],
      "current": { "id": "s12", "entityId": "set", "entityRevision": 3, "version": "8", "values": { "weight": 100, "reps": 6, "day": "2026-10-05" } } }
```

**Datetime value** (the entity also declares a `datetime` field `loggedAt`), and the same field refusing a non-canonical string:

```
PATCH /api/records/set/s12
{ "values": { "loggedAt": "2026-10-05T18:22:07.123Z" }, "entityRevision": 3, "baseVersion": "9" }

200 { "id": "s12", "entityId": "set", "entityRevision": 3, "version": "10", "values": { "weight": 100, "reps": 7, "day": "2026-10-05", "loggedAt": "2026-10-05T18:22:07.123Z" } }
```

```
PATCH /api/records/set/s12
{ "values": { "loggedAt": "2026-10-05T20:22:07+02:00" }, "entityRevision": 3, "baseVersion": "10" }

400 { "errors": [ { "path": "/values/loggedAt", "code": "invalid-value", "message": "\"loggedAt\" must be a UTC instant like 2026-10-05T18:22:07.123Z.", "hint": "Send UTC with milliseconds and a trailing Z." } ] }
```
