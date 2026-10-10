---
"@yadad/core": minor
"@yadad/renderer": minor
"@yadad/editor": minor
---

Breaking: table views use `quickFilters` (type `QuickFilter`) instead of `filters`; rename the key in existing documents. Validation results now carry `warnings` (code `empty`) for valid but empty documents, which the editors show; condition errors name the key each op takes and show its exact shape.
