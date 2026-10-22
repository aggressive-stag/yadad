---
"@yadad/editor": patch
---

FormViewEditor: Enter in a section's title input commits the rename, the
same as the "Rename section" button. Typing a new title already enabled
the button and dirtying the session, but Enter did nothing at all — a
keyboard user pressing it to finish the edit left Save disabled and the
section unchanged.
