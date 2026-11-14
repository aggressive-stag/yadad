---
"@yadad/runtime": minor
---

Add `editFormOffered(view, record, viewer)`: whether a record gets the Edit button of the view's `editForm` (`can.update` is not false and `editVisibleWhen` holds). `viewerLeavesRead` now also reads a table's `editVisibleWhen` and the edit form it opens.
