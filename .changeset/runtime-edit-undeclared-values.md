---
"@yadad/runtime": patch
---

`submitEdit` no longer refuses an edit because the server served values the
entity document does not declare. Served-but-undeclared keys are kept out of
the merge that is validated and are never sent in the patch; a record the
client builds is still checked strictly.
