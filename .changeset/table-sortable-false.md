---
"@yadad/core": minor
---

A table view and a table column may declare `"sortable": false` (only `false` is accepted; `true` is an `invalid-value` error, since sorting is the default). The view flag turns sorting off for every column, for a list the server serves in one order; the column flag opts one column out. A declared `sort` that names an unsortable column, or any field on an unsortable view, is a validation error that names the column. `describeContract()` documents both flags. The renderer does not use them yet.
