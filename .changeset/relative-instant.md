---
"@yadad/core": minor
"@yadad/runtime": minor
---

Add the relative instant `{ "hoursFromNow": N }` (a whole number, negative is the past) as the value of eq, neq, gt, gte, lt and lte on a `datetime` field, for windows such as "the last 24 hours". It is refused on other field types, in `in` and `contains`, and `{ "daysFromToday" }` stays refused on `datetime`. `resolveRelativeDates()` and `evaluateCondition()` resolve it against `now` to the stored `...Z` instant, so adapters and servers receive a concrete instant. `describeContract()` gains `conditions.relativeInstant`. New runtime exports: `instantFromNow()` and `resolveComparisonValue()`.
