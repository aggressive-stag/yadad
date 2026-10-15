---
"@yadad/renderer": minor
---

`TableRenderer` supports a table's `rowAction`: each row gets an "Open ..." button that replaces the table, in place, with the target table filtered by the row (heading naming the scope, Back button, focus moved to the heading and back to the row's button). It takes an optional `documents` prop (required for a row action), which `DashboardRenderer` passes, so it also works in a dashboard widget. `DocumentSet` moved to its own module and is still exported.
