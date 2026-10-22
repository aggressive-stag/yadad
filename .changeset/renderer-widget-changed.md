---
"@yadad/renderer": minor
---

Widgets refresh their neighbours after a write. `TableRenderer`,
`BoardRenderer` and `CalendarRenderer` take an optional `onChanged`,
called once after each successful user-initiated write made inside them:
an in-place edit, a move, a record action. A dashboard passes it to every
view widget, so a write in one cell reloads the others — the count and
stat widgets beside a table, board or calendar now update immediately
instead of holding the old number until the page reloads. (A form widget
already did this through `onSaved`; the other writers were left behind.)
A load or a reload never calls `onChanged`, so wiring the dashboards
reload bump through it cannot loop.
