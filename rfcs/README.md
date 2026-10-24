# RFCs

Proposals for changes to the contract (`packages/core`), the records protocol or the package list. An RFC starts as a Draft written by anyone (an agent included); the repo owner decides (accept, change, reject, defer), and only an accepted RFC is implemented, landing with its `specVersion` bump, `migrate()` step and fixtures as AGENTS.md requires.

Files are `NNNN-short-name.md`. Each carries a `Status:` line (Draft, Accepted, Rejected, Implemented, Superseded). Tracked RFCs describe consumers generically ("a workout log", "a task app") and never quote `*.private.md` files.

| RFC | Summary | Status |
| --- | --- | --- |
| [0001 Computed widgets](0001-computed-widgets.md) | Dashboard `stat` and `series` widgets that compute sums, distinct counts, min/max and group-by series over a table view's records, rendered as a number, table, bar or line | Accepted (slice 1 implemented) |
| [0002 Related records](0002-related-records.md) | A `reference` field type, a repeating group in forms, and an all-or-nothing transaction that creates a parent and its children with the new parent id | Accepted (slice 1 implemented) |
| [0003 Row drill-down](0003-row-drill-down.md) | A table `rowAction` that opens another view (or an edit form) scoped to the clicked row through typed field bindings | Accepted (slice 1 implemented) |
| [0004 Calendar view](0004-calendar-view.md) | A `calendar` view that places a table's records on the days of a month or week by one date field, with optional drag-to-another-day (and a keyboard "Move to day…" path) that changes that field | Accepted; slice 1 implemented |
| [0005 Board view](0005-board-view.md) | A `board` view that shows a table's records as cards in columns, one per value of a select, boolean or reference field the viewer can switch between, with optional drag-to-another-column (and a keyboard "Move to…" path) that changes that field | Accepted; slice 1 implemented |
| [0006 Who is viewing](0006-viewer.md) | A `viewer` document declaring select and boolean facts about the viewer, a `viewerIn` condition for hiding columns, fields, tabs and widgets and for turning off editing, per-record `can` permissions on records, and viewer axes in the state grid | Accepted; slice 1 implemented |
| [0007 Review screens](0007-review-screens.md) | Record actions (apply, reject, restore) with confirmation and typed input, a `datetime` field type, a word-diff `compare` column for version histories, and paging without a total | Accepted; slice 1 implemented |
| [0008 Consumer feedback round 1](0008-feedback-round-1.md) | Row-action binding by record id, reference `display` of a date, a `doneField` completion toggle, `TableView.addForm`, labelled select options with colour, `FormItem.label`, calendar detail lines and per-day cap, reference colour from the target, per-field write capability, board columns from reference options, `layout.Pager` registry key, headings, multi-line text, a `time` field type, a `tags` field type (items 1–15) | Draft |
| [0009 Consumer feedback round 2](0009-consumer-feedback-round-2.md) | A record field compared to a viewer fact, the union-list verdict, sub-record checklists as declared form sections, a batch-create composer, named saved filters, the search-box deferral, the membership boundary paragraph (items 1–7) | Draft |
