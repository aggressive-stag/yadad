---
"@yadad/renderer": minor
---

`TableRenderer` takes an optional `drill` and `onDrillChange`, and `DashboardRenderer` takes `drills` (keyed by grid item id) and `onDrillChange(itemId, drill)`, so a drill-down can live in a URL. Unset, the renderer keeps its private stack as before. A supplied drill is re-validated level by level and a stale one is cut back to its valid prefix with a polite notice. A controlled Back returns focus to the row it came from. `DrillStep` is exported.
