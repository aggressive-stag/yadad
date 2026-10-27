---
"@yadad/renderer": minor
---

`DashboardRenderer` takes a controlled-optional `tab` and `onTabChange(tab)`, shaped like `drills` / `onDrillChange`, so the selected tab can live in a URL. Unset, it behaves as before. A supplied tab the viewer cannot see falls back to the first visible tab and is reported through `onTabChange`.
