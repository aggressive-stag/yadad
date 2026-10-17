---
"@yadad/runtime": patch
"@yadad/editor": patch
---

Keep up with the new `viewerIn` condition op (RFC 0006, not implemented yet in these packages). `evaluateCondition` returns false for a `viewerIn` leaf (the answer for no viewer), and the editor describes one in words and treats it as not editable in the condition builder. Viewer semantics arrive in later releases.
