---
"@yadad/renderer": patch
---

Fix the focus return after a record action or a move when the host's adapter is slow or changes the record's id. The return now stays armed until the action's reload has landed (no fixed clock), so a table row's confirm dialog keeps focus on the row's control after a slow reload. An action that moves its record to another place in the order (a snooze that re-sorts a board) puts focus back on the record's trigger. A calendar move or a save whose answer carries a new record id (a derived record whose id holds the moved value) now follows that id: focus lands on the entry under the id the adapter answered with, never on a neighbour.
