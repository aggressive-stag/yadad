---
"@yadad/editor": patch
---

The editors now follow the `view` (or `entity`, `dashboard`, `viewer`) prop after a Save, as their README says. A host that stores the saved document and passes it back, without a `key`, gets a clean editor (Save disabled until the next edit), revisions N+1 then N+2 on two saves in a row, and Undo that still steps back past the Save. A document with another id, or a revision the editor did not produce, starts a new session; the same revision again (a failed save) keeps the edits.
