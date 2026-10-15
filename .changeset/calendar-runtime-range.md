---
"@yadad/runtime": minor
---

Add the calendar range math and queries (RFC 0004). Pure functions over "YYYY-MM-DD" strings: `visibleDays` (a month is always 42 days, a week 7), `visibleRange`, `shiftAnchor`, `calendarToday`, `periodTitle`, `weekdayLabels` and `dayLabel`. Queries: `rangeCondition` (the view's filter AND `gte`/`lte` on the date field), `calendarQuery` and `loadCalendarRange`, which pages through `find` (500 per request, capped at `CALENDAR_MAX_RECORDS` = 2000, with `truncated` set past the cap). Also `groupByDay`, `moveDay` (plans the date-only update, or reports that nothing should be sent) and `colorSlot` (0 to 7). Invalid dates or `weekStartsOn` throw `RangeError`. The adapter conformance suite now checks that an empty date matches neither `gte` nor `lte`.

Fix: `evaluateCondition` no longer lets a blank string match `gt`, `gte`, `lt` or `lte` (a blank text sorted below every value, so `lte` matched it). An empty value now matches none of the four, like a missing or null one.
