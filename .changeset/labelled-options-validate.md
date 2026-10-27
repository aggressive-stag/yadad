---
"@yadad/runtime": patch
---

`validateRecord` accepts the value of a labelled select option (`{ value, label }`), and its "not a choice" hint lists the values instead of `[object Object]`. A form or inline edit over a labelled select no longer fails client validation.
