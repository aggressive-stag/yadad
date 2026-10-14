# @yadad/runtime

Headless state and logic for yadad: form state and submission, condition evaluation, record validation, JSON Patch apply, and the memory, key-value and HTTP `DataAdapter` implementations (record versions and optimistic concurrency). No React, no DOM.

Imports `@yadad/core` only. See the repo [README](https://github.com/aggressive-stag/yadad) and [ARCHITECTURE.md](https://github.com/aggressive-stag/yadad/blob/main/ARCHITECTURE.md) (§10) for the adapter contract and the records protocol.

## Drafts

`createDraftStore(storage)` keeps unsaved form input so a reload or navigation does not lose it. `storage` is anything with `getItem`, `setItem` and `removeItem`, so `localStorage` works as-is. Entries live under `yadad:draft:<formViewId>:<recordId or "new">` (change the prefix with the second argument). Storage errors are swallowed; a draft never breaks a form.

```ts
import { createDraftStore } from "@yadad/runtime";
const drafts = createDraftStore(window.localStorage);
```

When a draft is loaded, `restoreDraft(entity, draft)` fits it to the entity as it is now: values for fields the entity no longer has are dropped (and listed in `droppedFields`), `revisionChanged` says the entity revision moved since the draft was taken, and it returns `null` if nothing is left to restore.
