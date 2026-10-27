---
"@yadad/runtime": patch
"@yadad/testing": patch
---

`validateRecord(entity, values, { mode })` takes `"write"` (the default, unchanged: a `readOnly` value is refused) or `"stored"` (a `readOnly` value is accepted and a `required` one must be present, as in `recordJsonSchema`'s stored mode). `viewStates` validates its generated records in stored mode, so a record carrying a server-set `required` + `readOnly` id is no longer reported as "not valid": its states are no longer skipped silently, and a dashboard series widget keeps its `widget:` axis. A `field:<id>` axis for a `readOnly` field is offered like any other field's (a condition on a server-set field is still exercised), with values that are valid stored values.
