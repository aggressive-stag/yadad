---
"@yadad/core": minor
---

A table with `editForm` can also set `editVisibleWhen`, a condition on the row's values and the viewer (record and `viewerIn` leaves, like a form item's `visibleWhen`): only rows it holds for get the Edit button. Optional and additive, so `specVersion` stays 10. It needs `editForm`, and its fields are checked against the table's entity.
