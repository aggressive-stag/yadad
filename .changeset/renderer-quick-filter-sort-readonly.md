---
"@yadad/renderer": minor
"@yadad/core": minor
---

`TableRenderer` renders what specVersion 9 declared. A quick filter opens on its `default` (seeded by the runtime's `initialQuickFilters`, never persisted), is labelled `filter.label ?? field.label`, and a text filter passes its `placeholder` to the text input slot; `@yadad/core` adds the optional `placeholder` to the text `Input` props (`TextInputExtras`). A header is plain text, and clicking does nothing, when the view or the column sets `sortable: false`. A `readOnly` field is never an inline input, even on a column marked `editable`.
