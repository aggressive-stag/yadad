# HTTP records protocol (v0, pre-contract)

How a host's backend serves records to yadad's HTTP `DataAdapter`. The adapter (`createHttpAdapter` in `@yadad/runtime`) speaks this protocol and nothing else; a backend that implements it gets tables, forms and dashboards without writing UI code.

It is pre-contract like the documents: it can still change before `contract-v0`, and a change here is a change for both sides.

## Basics

- **Base URL** is host configuration (e.g. `/api/records`), never part of a document. `{entity}` is an entity document's `id`.
- **Same origin.** The adapter calls `fetch` with `credentials: "same-origin"` by default, so session cookies just work. No CORS is assumed.
- **JSON** request and response bodies, `Content-Type: application/json`.
- **Ids are opaque strings.** The server picks them; the client never parses or builds one. An id is never reused for a different record, even after a delete. A server whose ids follow position (and so can shift when a record is removed) must instead require `baseVersion` on every update and delete, so a stale id conflicts rather than hitting another record.
- **Field values** are `string | number | boolean | null`. Dates are `"YYYY-MM-DD"` strings. `null` means empty.

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

- `can` is optional and states what the viewer making the request may do with this record: `{ "update"?: boolean, "delete"?: boolean }`. A missing `can`, or a missing key in it, means "not stated": the client offers the action and the server decides, so servers that do not implement it change nothing. It only restricts: `"update": true` enables nothing the document does not already offer. It is a read-time snapshot for this viewer, may change without `version` changing, and is never cached across reloads or sent back: a request body never carries `can`, and a server ignores it if sent. It appears on every Record the server returns (list items, `GET`, `POST`/`PATCH`/batch responses, the `current` record of a `409`). The server still enforces: a refused write is a `403`. A client treats a malformed `can` (not an object, a non-boolean, an unknown key) as absent.
- `entityRevision` is a schema stamp, not concurrency control: old records are upcast on read. A write carries the revision the client built its `values` against, and the server stamps it on the saved record. A server never rejects a write because the request's `entityRevision` is older or newer than its own current one: it judges the `values` by its own rules, so a field it does not know is a `400` (unknown field) and everything else is accepted. The stamp is the only thing the revision changes.
- `version` is concurrency control. The client sends it back as `baseVersion` on writes; the server rejects the write if the record changed since. It must change on every write that changes the record, so two writes close together never share one. Its format is the server's business (a counter, a hash, or a timestamp fine-grained enough for that). Several records may share a version if the server stores them together; a write to any of them changes all of their versions.

## Validating records on the server

Do not re-implement the field rules. Generate a JSON Schema (draft 2020-12) from the entity document and validate each write's `values` against it. In JavaScript, `recordJsonSchema(entity)` from `@yadad/core` returns it. Without JavaScript in the backend's runtime, generate the files at build time from the repository:

```sh
node tools/record-schema.mjs entities/set.json > schemas/set.schema.json   # or: pnpm record-schema entities/set.json
```

Then, for example in Python with `jsonschema` (install `jsonschema[format]` for the `date` format check):

```python
import json
from jsonschema import Draft202012Validator, FormatChecker
validator = Draft202012Validator(json.load(open("schemas/set.schema.json")), format_checker=FormatChecker())
errors = list(validator.iter_errors(request_values))  # empty list means valid
```

Regenerate the schema whenever the entity changes revision.

What the schema says: one property per field; `additionalProperties: false` (unknown field); `required` lists required fields; optional fields also accept `null`; a required boolean must be `true`; a required text or reference field must not be blank; a select is an `enum`; a number has `minimum`/`maximum`; a date is a `YYYY-MM-DD` string within `min`/`max`.

### Where the schema and `validateRecord` differ

`validateRecord` (the browser check) is checked against the schema by a parity test that fails when one changes without the other. These cases are the known, deliberate differences:

- **Blank strings.** `validateRecord` treats `""` and whitespace-only strings as empty for every field type. The protocol says empty is `null`, so the schema rejects `""` for number, boolean, select and date fields (text and reference fields are strings, so an optional one accepts it). A server should reject them too.
- **Step.** JSON Schema `multipleOf` counts from zero and divides in floating point. The schema emits it only when that is exact (the step is a binary fraction such as 1, 0.5 or 0.25, and `min` is a multiple of it). Otherwise (a step like 0.1, or a `min` that is not a multiple of the step) the rule is only described in the field's `description` and the server must check it itself, counting steps from `min`. Even when emitted, `validateRecord` forgives a float error of 1e-9 that `multipleOf` does not.
- **Calendar dates.** The schema checks the `YYYY-MM-DD` shape and the `min`/`max` range exactly (as patterns), but `2026-02-30` is rejected only by a validator that asserts the `date` format (most do, when format checking is enabled).

## Endpoints

| Method and path | Body | Success |
| --- | --- | --- |
| `GET {base}/{entity}?filter=&sort=&offset=&limit=` | — | `200 { "items": Record[], "total": number }` |
| `GET {base}/{entity}/{id}` | — | `200 Record` |
| `POST {base}/{entity}` | `{ "values", "entityRevision" }` | `201 Record` |
| `PATCH {base}/{entity}/{id}` | `{ "values", "entityRevision", "baseVersion" }` | `200 Record` |
| `DELETE {base}/{entity}/{id}?baseVersion=` | — | `204` |
| `POST {base}/{entity}/_batch` | see below | `200 { "created": Record[], "deleted": string[] }` |

`{id}` is URL-encoded. Ids never start with `_`, so `_batch` cannot collide with one.

### Listing

- `filter`: a URL-encoded JSON condition, exactly the `Condition` AST from `@yadad/core` (ops `eq neq gt gte lt lte in contains empty notEmpty and or not`). Optional.
- `sort`: URL-encoded JSON array of `{ "field", "dir": "asc" | "desc" }`, first key first. Empty values sort last in both directions. Optional; without it the order is the server's choice but stable.
- `offset` (default 0, minimum 0) and `limit` (default 50, minimum 0, maximum 500). `limit=0` is legal: `items` is empty and `total` is still the real count (a count widget uses this). A `limit` above 500, a negative or non-integer `offset` or `limit` is a `400`.
- `total` counts every record matching `filter`, ignoring `offset` and `limit`.

The server must translate conditions by whitelist: every op and field id is checked against what it knows and mapped to its storage. It never builds a query from strings in the request. An unknown op or field is a `400`.

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
| `403` | Signed in but not allowed | — |
| `404` | Unknown entity, or no such record for this user (another user's record is also a `404`) | — |
| `409` | `baseVersion` is stale | `"current": Record` (or `null` if it was deleted) so the client can show or merge it |

The adapter turns these into typed errors; it does not retry writes on its own.

## Examples

Compact request and response pairs for each endpoint, for an entity `set` (fields `weight`, `reps`, `day`).

**List with filter and sort.** `filter` is `{"op":"gte","field":"weight","value":100}` and `sort` is `[{"field":"day","dir":"desc"}]`, URL-encoded:

```
GET /api/records/set?filter=%7B%22op%22%3A%22gte%22%2C%22field%22%3A%22weight%22%2C%22value%22%3A100%7D&sort=%5B%7B%22field%22%3A%22day%22%2C%22dir%22%3A%22desc%22%7D%5D&offset=0&limit=2

200 { "items": [ { "id": "s12", "entityId": "set", "entityRevision": 3, "version": "7", "values": { "weight": 100, "reps": 5, "day": "2026-10-05" } } ], "total": 1 }
```

**Count only** (`limit=0`): `GET /api/records/set?limit=0` returns `200 { "items": [], "total": 41 }`.

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
