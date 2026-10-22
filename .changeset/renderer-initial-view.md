---
"@yadad/renderer": minor
---

Open a board or a dashboard on a chosen view without taking control of
it. `BoardRenderer` takes `initialGroupBy`: the grouping the board opens
on, read only on the first render, so a state grid can open a board in
another grouping and the viewer can still use the switcher — the
controlled `groupBy` prop froze it. `DashboardRenderer` takes
`initialTab` for the same reason (a states preview opens a dashboard on
a second tab). An unknown id is never an empty render: an unknown
grouping falls back to the board's default, and a tab that names no tab
— or a tab this viewer may not see — falls back to the first visible
one. After the first render the viewer's own choice always wins.
