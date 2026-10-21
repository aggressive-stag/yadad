---
"@yadad/editor": minor
---

The entity editor gained an Actions section: add, rename, set the confirm (title, message, confirmLabel, tone), reorder, and remove an entity's record actions, each as an undoable JSON Patch. Removal is refused while a view still offers the action, naming the views. New helpers in `@yadad/editor`: `addAction`, `updateAction`, `moveAction`, `removeAction`, `actionReferences`.
