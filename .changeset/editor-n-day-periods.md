---
"@yadad/editor": minor
---

The calendar editor offers the rolling periods and the phone list start.

The mode checkbox list grows from month/week to 1day, 3day and 5day (RFC 0004
amendment), and a two-option "Phone list starts at" control — "Start of period" or
"Today" — sets `listStart`. The defaults are unchanged: a calendar left as it was keeps
month/week and a period-started list, and choosing the default option removes the key
rather than writing it, so an untouched document saves byte-identically.
