---
"@yadad/runtime": minor
---

`act` in the memory and key-value adapters (RFC 0007): the `AdapterOptions.actions` option carries host-supplied `ActionHandler`s keyed `<entity>.<action>`, and `act` checks, in protocol order, unknown action then unknown record (`RecordNotFoundError`), `baseVersion` (`RecordConflictError` with the current record), `can.actions[id] === false` and the `can.update` rules (`ForbiddenError`) — then runs the handler and applies its outcome: a values patch with a fresh version, or removal (returning `null`). A handler-thrown `RecordConflictError` passes through. Adapter conformance covers both paths plus the empty outcome and the permission-visible-to-the-handler case.
