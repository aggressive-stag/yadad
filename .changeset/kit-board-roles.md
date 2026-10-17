---
"@yadad/testing": patch
---

The contract kit's board checks now find the board and its columns by role and accessible name, as RFC 0005 describes them (a group named by the board label; each column a group or region named "<label>, <count> cards"; cards as list items inside their column), instead of looking for `data-testid="board"` and `data-testid^="column-"`. A component set no longer needs those test ids to pass.
