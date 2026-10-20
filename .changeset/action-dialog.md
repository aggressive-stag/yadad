---
"@yadad/core": minor
"@yadad/renderer": minor
"@yadad/testing": minor
---

The confirm and input dialog (RFC 0007): pressing an action with `confirm` or `input` opens `layout.Dialog` — the renderer builds the content (the message, the input fields as FieldFrame plus the type's Input, an ErrorSummary, Cancel and Confirm), the component only provides the modal behaviour. Confirm validates with `validateActionInput` before the server sees anything, then calls `act` with Confirm disabled and "Working..." announced. A 400 keeps the dialog open and puts each `/input/<id>` issue on its field; 403/409/404 close it, show the view's ErrorSummary and reload (nothing merged, nothing retried); any other failure keeps it open with the message so the viewer can retry. Cancel and Escape never call `act`, and the modal returns focus to the pressed button. The 35f restriction is gone: every offered action is now pressable. `ButtonProps` gains the optional `tone: "danger"` (the mock renders `data-tone`), so a `danger` confirm reaches the Button.
