---
"@yadad/renderer": minor
---

`TableRenderer` and `DashboardRenderer` take an optional `drill` and `onDrillChange`, so a drill-down can live in a URL. Unset, the renderer keeps its private stack as before. A supplied drill is re-validated level by level and a stale one is cut back to its valid prefix with a polite notice. `DrillStep` is exported.
