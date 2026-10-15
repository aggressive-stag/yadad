---
"@yadad/renderer": minor
---

Add `CalendarRenderer` for `calendar` views, also used by the dashboard `view` widget. It loads the visible range through the runtime, builds entries with the fields' Display components and hands days, entries and callbacks to `layout.Calendar`. With `editable: true` a move is optimistic: only the date field is sent with `baseVersion`; on any failure the entry goes back, the adapter's message shows in an error summary, a live-region message is sent and the range reloads. A `rowAction` opens the target table in place, with Back. A registry without `layout.Calendar` gets an error summary instead of a crash.
