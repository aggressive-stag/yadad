---
"@yadad/renderer": minor
---

`FormRenderer` takes an optional `record` prop (card 99) and edits that record: it shows the record's values and saves through `submitEdit`, sending only the fields the viewer changed with the record's version as `baseVersion`. A stale save shows the conflict message in the form and keeps what was typed; fields the form does not show are never sent. `TableRenderer` honors the table's `editForm` (core 0.19.0): each row gets an Edit button that opens its record in that form in place of the table, with Back, and a save returns to the reloaded table. Drafts are kept per record.
