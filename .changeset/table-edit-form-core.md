---
"@yadad/core": minor
---

Adds the optional table key `editForm` (card 99, introduced in core 0.19.0): the id of a form view over the same entity, which the renderer opens on a row's record to edit it. The validator checks that it names an existing form view over the table's own entity that is not a batch composer, and its errors list the forms that would do. `rowAction` still opens another table; a `rowAction.edit` key now says to use `editForm`. The change is additive, so `specVersion` stays 10.
