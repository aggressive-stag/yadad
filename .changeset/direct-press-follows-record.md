---
"@yadad/renderer": patch
---

A plain action button pressed on a record that the action moves (to another board column, calendar day or table position) now returns focus to the same record's control in its new place, the same way a press from a panel does. Focus still never lands on a neighbour that took the old place, and a record that left the view leaves focus alone. Table rows that offer actions carry an empty hidden marker in their first cell so the row can be found again.
