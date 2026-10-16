---
"@yadad/editor": minor
---

Add `CalendarViewEditor` for `calendar` views, in the style of the table and form editors. It edits the title, date/title/colour fields, week start, whether dragging an entry moves it, the sort within a day and a fixed filter (through the shared condition builder), up to `CALENDAR_DETAIL_FIELDS_MAX` detail fields (draggable by a grip or moved with the arrow keys, each move one undoable patch), the `modes` a viewer can switch between and their default, and the `rowAction` (shared with the table editor's row-action targets). The showcase's bookings calendar now goes through the normal view/edit flow (the demo entity and views are folded into its documents) instead of a hardcoded section, so it is reachable from the standard "Edit" toolbar and `DashboardLayoutEditor`'s palette offers calendars as embeddable widgets.
