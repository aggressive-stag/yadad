---
"@yadad/editor": minor
---

Add `BoardViewEditor` for `board` views, in the style of the calendar editor. It edits the title, the title field, whether dragging a card moves it, the card order within a column, a fixed filter (through the shared condition builder), the `groupBy` list (only select, reference and optional boolean fields are offered, one to `BOARD_GROUP_BY_MAX`, the first is the default), up to `BOARD_CARD_FIELDS_MAX` card fields, and the `rowAction` (shared with the table editor's row-action targets). Groupings and card fields can be dragged by a grip or moved with the arrow keys or Move buttons; each change is one validated, undoable patch and the new position is announced. Also adds the board patch helpers in `views.ts` (`addBoardGroupBy`, `setBoardTitleField`, `moveBoardCardField` and so on), `blankBoard`, and offers board views as embeddable widgets in `DashboardLayoutEditor`'s palette.
