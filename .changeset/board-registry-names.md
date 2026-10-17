---
"@yadad/core": minor
---

Align the board registry types with RFC 0005. Registry implementers of `layout.Board` must change: `BoardColumn` has `id` (stable: `v:<value>`, `empty` or `other`), `count` and `droppable` instead of `value`; `BoardProps.groupedBy` is now `groupField`; `onGroupChange` is now `onGroupBy`; and `onMove` is called with `(recordId, columnId)` where `columnId` is a column `id`, not a raw value. Column order and `cards` are as before.
