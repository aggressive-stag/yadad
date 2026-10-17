---
"@yadad/editor": minor
---

Add `StatesPreview`, which a host puts next to a view editor to see every state of the document being edited. It marks the states that are new or look different from the saved revision, and shows the host's check problems per state (through `checkStates`, since the editor cannot import the testing package). The form, table, calendar and board editors take a new optional `onChange` that reports the document after each edit, undo or redo.
