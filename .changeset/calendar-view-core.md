---
"@yadad/core": minor
---

Add the `calendar` view kind (RFC 0004) and bump `specVersion` to 3. A calendar places the records of one entity on the days of a month or week by one `date` field (`dateField`), with optional `titleField`, `detailFields`, `colorField`, `filter`, `sort`, `modes`, `weekStartsOn`, `editable` and `rowAction`. A dashboard `view` widget can embed one; `count` and `stat` widgets still take table views only. `migrate()` upgrades version 2 documents by stamping version 3, and older documents stay valid. New exports: `CalendarView`, `CALENDAR_MODES`, `CalendarMode`, the calendar limits in `contract.ts`, and the registry types `CalendarProps`, `CalendarDayProps` and `CalendarEntry`. `Registry.layout.Calendar` is optional for now, so existing registries keep type-checking; `describeContract()` gains `calendar` and `optionalRegistryKeys`. `ViewDocument` and `DOCUMENT_KINDS` gain `calendar`, so code that switches over view kinds needs a calendar case (or a default).
