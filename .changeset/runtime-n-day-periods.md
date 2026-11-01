---
"@yadad/runtime": minor
---

RFC 0004 amendment (2026-10-31), runtime half: the calendar period math handles the rolling family. A `"3day"` period is three consecutive days starting at the anchor — `visibleDays` returns n days all `inMonth: true`, `visibleRange` spans exactly n (month and week unchanged, byte for byte), `shiftAnchor` moves prev/next by n, `periodTitle` gives the rolling range label ("3 to 5 November 2026"; a "1day" period titles as one date). New `periodLength(mode)` is the single source for a mode's column count, and `weekdayLabels(weekStartsOn, locale, days?)` now labels one grid column each — the three labels of a Thursday-anchored 3-day grid are Thu, Fri, Sat. `loadCalendarRange` needs no change: it is range-generic.
