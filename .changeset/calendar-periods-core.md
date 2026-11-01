---
"@yadad/core": minor
"@yadad/editor": patch
"@yadad/renderer": patch
---

RFC 0004 amendment (2026-10-31), core half: `CalendarMode` widens to the rolling family — `"1day"` through `"6day"` alongside `month` and `week`. An n-day period starts at the anchor and covers n consecutive days; prev/next move by n; Today re-anchors. `0day`, `7day`, `10day` and a bare `day` are refused, each with a hint naming the family. `CalendarView.listStart` (`"period" | "today"`, default `"period"`) and `CalendarProps.listStart` arrive validated; the laptop grid ignores it. `weekdays` is now "one per grid column, in column order" — identical for month/week, correct for a rolling period. `isCalendarMode()` guards document values; `CALENDAR_MODES_DEFAULT` is the absent-key default. specVersion stays 10: additive, no migrate() step. The editor and renderer keep compiling with the smallest change (month/week behaviour unchanged); their real N-day work is cards 61b/61c.
