---
"@yadad/runtime": patch
---

`ReferenceOptionsResult` (from `loadReferenceOptions` and `loadBoardTargets`) gains `total`, the target's full record count, so a caller can say "Showing 50 of 63". Existing fields are unchanged.
