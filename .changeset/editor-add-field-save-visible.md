---
"@yadad/editor": minor
---

EntityFieldsEditor's "Save fields" now sees a filled Add-field panel.
Typing an id and label enabled nothing and pressing Save silently
dropped the draft — the two-step commit (Add field, then Save fields)
was invisible. A filled, valid draft enables Save fields and adds the
field before saving; an invalid one keeps Save disabled and shows the
validator's reason in the panel. Typing still never touches the edit
session until a press.
