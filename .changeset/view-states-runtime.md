---
"@yadad/runtime": minor
---

Add `viewStates(view, documents, { now, limit })`: lists the states a view can be in, read from its documents.

The conditions a view uses (form `visibleWhen` and `requiredWhen`, the `filter` of a table, calendar or board, row-action bindings) become axes with boundary values by type, and the view kind adds axes (record counts, a calendar's mode, a board's `groupBy`, a dashboard's tabs and embedded views). Axes are combined into at most `limit` states (default 24): every combination when they fit, otherwise a deterministic pairwise cover. Each state has a stable `id`, a readable `label`, the chosen value per axis and what to render (form values, or validated records and the matching ids, plus `now`). A state that cannot be built is left out and listed under `skipped`. Also exports `combineAxes(axes, limit)`, the generic combiner, and the `StateAxis`, `ViewState` and related types.
