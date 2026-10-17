---
"@yadad/core": minor
---

Add viewer facts and per-record permissions to the contract (RFC 0006, slice 1). `SPEC_VERSION` is now 5; `migrate()` stamps older documents and changes nothing else, and documents that use none of the new keys behave as before. New: the `viewer` document kind (`ViewerDocument`, `ViewerFact`, `VIEWER_FACT_TYPES`, `VIEWER_FACTS_MAX`, `VIEWER_FACT_VALUES_MAX`, `ResolvedViewer`, `ViewerFactValue`); the `viewerIn` condition op and the `ViewerCondition` subset; `conditionViewerFacts()`; optional viewer-only `visibleWhen` on table columns, `rowAction`, dashboard tabs and grid items, and `editableWhen` on table columns, calendars and boards; `DataRecord.can` (`RecordPermissions`); `describeContract()` gains `viewer` and `conditionPlaces`. A viewer leaf is rejected in any `filter`, and a record leaf in a viewer-only place.

What users must change: code that switches exhaustively on `Condition["op"]`, or reads `condition.field` in a default branch, needs a `viewerIn` case (it has `fact` and `values`, no `field`; `conditionFields()` returns nothing for it). Code that switches on `Document["kind"]` needs a `"viewer"` case; `DOCUMENT_KINDS` and `Document` gain it, and `ViewerDocument` is not a `ViewDocument`. Everything else is additive and optional.
