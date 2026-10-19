---
"@yadad/runtime": minor
---

Add `availableActions`, `actionNeedsDialog` and `validateActionInput` (RFC 0007): the view's `recordActions` filtered by the action's `visibleWhen` for the record and viewer and by `record.can.actions`, in the view's order (unavailable actions are dropped, never disabled); the dialog rule (`confirm` or `input` opens one); and input checking that reuses `validateRecord` over the action's input fields with issue paths under `/input/`. Also the `ActionHandler`/`ActionOutcome` types the memory and key-value adapters consume.
