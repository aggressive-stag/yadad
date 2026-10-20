---
"@yadad/runtime": minor
---

`act` over HTTP (RFC 0007): `POST {base}/{entity}/{id}/actions/{action}` with `{ input, entityRevision, baseVersion }`; `200` is the acted record, `204` (removed) is `null`, and `400` (paths `/input/<field>`), `401`, `403`, `404` and `409` map to the existing typed errors, the `409` carrying `current`. The HTTP adapter always offers `act` — unknown entity, record or action is the server's 404. `can.actions` is validated on read like the rest of `can`: an object of booleans passes, a malformed one is dropped as a whole (a hint, never an error).
