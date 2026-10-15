---
"@yadad/editor": minor
---

`TableViewEditor` can set and clear a table's row action (RFC 0003): pick another table view, one field here and a same-typed field of the target. It takes an optional `context` prop (`{ tables, entities }`); without it the section is hidden. `setRowAction()` and `rowActionTargets()` are exported; the patch is checked with the document validator, so unknown targets, type mismatches, cycles and over-deep chains are refused with its message and hint.
