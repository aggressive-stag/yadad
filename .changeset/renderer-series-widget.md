---
"@yadad/renderer": minor
---

Dashboards draw series widgets. A `series` grid item on a table view now loads through `aggregateSeries` and hands the registry's `widgets.series` ready-to-draw props: group labels per field type (select/text raw, boolean Yes/No, dates formatted with the viewer's locale — day, "Week of …", "October 2026" — references through the references hook, with the 39b unwired-target warning), the measure's words (`measureLabel`), and `skipped`/`partial` pass-through. No `widgets.series` in the registry names the missing key like a missing `layout.Calendar` does; a failed read shows the same load error the stat widget shows. `checkDashboard` reports a series pointed at a calendar/board view, a missing `groupBy` field, and a bad measure field.
