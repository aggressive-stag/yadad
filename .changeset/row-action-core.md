---
"@yadad/core": minor
---

Table views gain an optional `rowAction` (`{ open, bind: [{ field, to }], mode? }`, RFC 0003 slice 1): a row opens another table view filtered by the row's values. The validator checks the target is a table, both fields exist with the same type, no cycles and at most 3 hops (`MAX_ROW_ACTION_DEPTH`). `describeContract()` reports it.
