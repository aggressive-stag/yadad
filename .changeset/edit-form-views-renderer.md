---
"@yadad/renderer": minor
---

A calendar entry or board card opens its record in the view's `editForm`: an "Edit <title>" item among its record actions, which the registry's component draws like any action. The form replaces the view with a Back button and a focused heading; a save or Back returns to the reloaded view with focus back on that control. It reuses the table's save path (changed fields only, `baseVersion`, the conflict message in the form) and honours `can.update` and `editVisibleWhen`.
