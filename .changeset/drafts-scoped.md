---
"@yadad/runtime": minor
---

Drafts can be scoped to a user and cleared on sign-out. `createDraftStore(storage, { prefix, scope })` keys drafts per `scope` (the old `(storage, prefix)` form still works), `clearDrafts(storage, { prefix, scope })` removes one scope's drafts or, with no scope, all of them including unscoped keys, and `DraftStore.clear()` with no arguments clears the store's scope. A store created without `scope` warns once in the console.
