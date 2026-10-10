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
  "values": { "weight": 100, "reps": 5 }
}
```

- `entityRevision` is a schema stamp, not concurrency control: old records are upcast on read.
- `version` is concurrency control. The client sends it back as `baseVersion` on writes; the server rejects the write if the record changed since. It must change on every write that changes the record, so two writes close together never share one. Its format is the server's business (a counter, a hash, or a timestamp fine-grained enough for that). Several records may share a version if the server stores them together; a write to any of them changes all of their versions.

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
- `offset` (default 0) and `limit` (default 50, maximum 500).
- `total` counts every record matching `filter`, ignoring `offset` and `limit`.

The server must translate conditions by whitelist: every op and field id is checked against what it knows and mapped to its storage. It never builds a query from strings in the request. An unknown op or field is a `400`.

### Writes

- **Create:** `values` holds the fields to set. Omitted fields are empty.
- **Update:** `values` is a partial patch. An omitted field is unchanged, an explicit `null` clears it. `baseVersion` is required. An empty `values` is a no-op: `200` with the current record and its version unchanged (a stale `baseVersion` is still a `409`). The client skips the request when nothing changed, but servers must accept it.
- **Delete:** `baseVersion` is optional. When present, the server rejects the delete with `409` if the record changed since. Clients send it whenever they have it.
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

All or nothing: if any item fails, nothing is written and the response is the error for the first failing item, with `path` pointing into the request body (e.g. `/create/2/values/reps`). Deletes run before creates.

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
