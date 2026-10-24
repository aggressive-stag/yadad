---
"@yadad/runtime": patch
"@yadad/renderer": patch
---

`restoreDraft` validates restored values against the current schema. A stale draft whose typed value no longer fits (text in a number field, a choice removed from a select) is kept AND reported in the new `invalidFields` — the renderer seeds it into `FormState.errors`, so the field frames invalid and the ErrorSummary names it — instead of restoring silently. Absent `required` values are not flagged at restore; the submit path already reports those. Fixes the fitnotes F10-era draft case: an old draft used to return with its broken value looking untouched.
