---
'@yadad/editor': minor
---

Add `ConditionBuilder` and condition helpers for form, table, and layout editors:

- `conditions.ts`: `ConditionDraft` (flat canonical form), `toCondition`, `draftFromCondition` (non-canonical/deep conditions round-trip as-is), `summaryCondition`
- `condition-builder.tsx`: comparison rows with field/op/value derived from entity field types, all/any combining, negation, add/remove, draft validation
- `views.ts`: `setFormItemCondition` (requiredWhen + visibleWhen + clearWhenHidden), `setTableFilter`, `setCountWidgetFilter`
- `FormViewEditor`: per-item required/visible rules editable in place; deep conditions render read-only with a Replace button (wholesale replace only, no half-edits)
- `TableViewEditor`: "rows always match" filter editable via the builder
- `DashboardLayoutEditor`: count-widget filter per widget, isolated from the counted table's own filter
