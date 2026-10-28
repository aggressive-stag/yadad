---
"@yadad/renderer": patch
---

Focus now returns to the record's trigger after a confirm or input dialog action run from a panel (it ended on the page body before), and the focus return finds the record in its own view when another view on the page shows the same record (a calendar move ended on the body when a board above it showed the same booking). Each record title carries `data-yadad-record-view`, one value per view. Cancelling or closing the dialog is unchanged.
