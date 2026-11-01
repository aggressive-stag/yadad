---
"@yadad/renderer": patch
---

`DashboardRenderer` takes `now` and forwards it to the views it embeds.

The dashboard passed `drafts`, `formatting` and `viewer` down to an embedded calendar
or board but not the clock, so a host that renders a saved document at a fixed moment
— a states preview, a test with dated fixtures — had no way to pin "today". The calendar
fell back to `new Date()` and opened on whatever month the machine was in.
`<CalendarRenderer now>` and `<BoardRenderer now>` already accepted the pin; the
dashboard was the hole. Pass it through and the document renders the same on any clock.
