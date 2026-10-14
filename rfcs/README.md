# RFCs

Proposals for changes to the contract (`packages/core`), the records protocol or the package list. An RFC starts as a Draft written by anyone (an agent included); the repo owner decides (accept, change, reject, defer), and only an accepted RFC is implemented, landing with its `specVersion` bump, `migrate()` step and fixtures as AGENTS.md requires.

Files are `NNNN-short-name.md`. Each carries a `Status:` line (Draft, Accepted, Rejected, Implemented, Superseded). Tracked RFCs describe consumers generically ("a workout log", "a task app") and never quote `*.private.md` files.

| RFC | Summary | Status |
| --- | --- | --- |
| [0001 Computed widgets](0001-computed-widgets.md) | Dashboard `stat` and `series` widgets that compute sums, distinct counts, min/max and group-by series over a table view's records, rendered as a number, table, bar or line | Draft, needs owner decision |
| [0002 Related records](0002-related-records.md) | A `reference` field type, a repeating group in forms, and an all-or-nothing transaction that creates a parent and its children with the new parent id | Draft, needs owner decision |
| [0003 Row drill-down](0003-row-drill-down.md) | A table `rowAction` that opens another view (or an edit form) scoped to the clicked row through typed field bindings | Draft, needs owner decision |
