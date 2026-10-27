---
"@yadad/core": minor
---

`ActionConfirm` gains an optional `subjectField`: a field id of the action's entity. The dialog shows that field's display value as a subject line under the message, so a confirmation can name its record without a template. Any field type is allowed, including read-only ones; an unknown field is an `unknown-reference` error.
