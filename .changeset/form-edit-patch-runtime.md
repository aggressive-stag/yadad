---
"@yadad/runtime": minor
---

Adds `formEditPatch(entity, view, record, touched, viewer?)`, which turns what a form's viewer touched into the patch `submitEdit` saves: only touched fields, with the form's `visibleWhen`, `requiredWhen` and `clearWhenHidden` rules applied to the record as it would look after the edit. A field the form does not show is never in the patch.
