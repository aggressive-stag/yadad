---
"@yadad/editor": minor
---

Edit viewer facts and viewer conditions (RFC 0006).

- New `ViewerPanel` declares the facts of a `viewer` document: add, remove, reorder and relabel facts, edit a select fact's values and each default. Given `documents`, removing a fact or value that a condition still reads is refused and the places that read it are listed. Patch helpers are exported (`addViewerFact`, `removeViewerFactValue`, `viewerEditConflicts`, ...), plus `blankViewer`.
- The condition builder takes `viewer` and `sources`, and offers a "The viewer" source next to the record field. `FormViewEditor`, `TableViewEditor`, `CalendarViewEditor`, `BoardViewEditor` and `DashboardLayoutEditor` take an optional `viewer` prop; with it, columns, row actions, calendars, boards, dashboard tabs and widgets get `visibleWhen` / `editableWhen` controls (`ViewerRule`), and form items can read a viewer fact. Turning editing off also drops `editableWhen`.
- `StatesPreview` matches saved and edited states by the axis values they share, so adding a condition no longer marks every state New and lists all the old ones as gone, and it names the viewer facts a view reads.

`ConditionBuilder`'s `entity` prop is now optional (omit it where there is no record). `describeCondition` takes an optional third argument to label viewer facts.
