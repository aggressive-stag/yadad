---
"@yadad/core": minor
---

Add `validateDocuments(inputs)`, which validates a set of documents together, on top of checking each one alone: every form/table view's `entity` exists, every field id used by forms (items and conditions), tables (columns, sort, quick filters and fixed filter) and a dashboard `count` widget's filter exists on the view's entity, dashboard `view` widgets point at an existing form or table and `count` widgets at a table, and document ids are unique per kind. New closed error code `unknown-reference`; `DocumentError` gains optional `document` (the id of the document the error belongs to) and `allowed` (the ids or values that would have been accepted).
