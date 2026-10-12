---
"@yadad/editor": minor
---

Drag-to-reorder in the view editors: field rows and section legends in `form-view-editor` and column headers in `table-view-editor` can be reordered by pointer drag (mouse and touch) or by focusing a drag grip and using the arrow keys. A drop indicator shows the landing row while dragging, applied moves are announced in the editor's live status line, and a drop onto a row's current position is a no-op that leaves the undo stack untouched.

Also exported for custom editors: the `useReorder` hook with its `ReorderGrip` and `DropIndicator`, the shared pointer-drag math (`nearestSpan`, `insertIndex`, `flatIndex`), and the single-patch move primitives `moveFieldTo`, `moveSectionTo`, and `moveColumnTo`.
