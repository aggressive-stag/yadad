---
"@yadad/renderer": patch
---

Return focus to the row's live control after a direct action press. The focus return added for todo-app F9:227 held the pressed button and focused it once the flight ended, but a completing row's action set changes on the reload that follows (Complete unmounts, Reopen mounts — measured in Chromium: the pressed node is removed ~90ms into the press while the row survives), so the held node was gone and the restore silently no-op'd with focus on body. The press now also holds the button's parent (the action cell, which survives the swap) and the effect retries across renders until a restore survives a commit: focus goes back to the pressed button when it lives, or the parent subtree's first live button when it was replaced. A removed record still leaves focus where it is, and a focus the viewer moved elsewhere is never stolen.
