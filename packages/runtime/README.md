# @yadad/runtime

Headless state and logic for yadad: form state and submission, condition evaluation, record validation, JSON Patch, drafts, and the `DataAdapter` implementations. No React, no DOM; it depends only on `@yadad/core`, so the same logic runs in tests or on a server.

```sh
npm install @yadad/runtime @yadad/core
```

## Data adapters

All three implement `DataAdapter` with record versions and optimistic concurrency: a write carries the `baseVersion` it read, and a stale one throws `RecordConflictError`.

```ts
import { createHttpAdapter, createKeyValueAdapter, createMemoryAdapter } from "@yadad/runtime";

const memory = createMemoryAdapter();                          // tests, demos; nothing persists
const local = createKeyValueAdapter(window.localStorage, "app"); // survives a reload
const http = createHttpAdapter({
  baseUrl: "/api/records",
  onUnauthorized: () => { window.location.href = "/sign-in"; },
});
```

`createHttpAdapter` speaks the [records protocol](../../docs/records-protocol.md) and nothing else. It sends cookies same-origin by default (`credentials`), takes extra `headers` and a custom `fetch`, and maps every non-2xx status to a typed error. `onUnauthorized` runs on any 401 (the call still rejects with `UnauthorizedError`). Pass `{ fields: { entity_id: ["field_id"] } }` to the memory and key-value adapters to reject writes that name unknown fields.

## Logic

- `evaluateCondition(condition, values)`, `evaluateFormRules(view, values)` and `applyFormRules(entity, view, values)`: visibility and required-ness. Hidden fields keep their values unless the item sets `clearWhenHidden`. Relative dates (`{ daysFromToday: n }`) resolve to local `"YYYY-MM-DD"` before evaluation and before any adapter call.
- `validateRecord(entity, values)`: record validation against the entity's field rules.
- `submitForm(entity, values, adapter)` and `submitEdit(entity, record, patch, adapter)`: validate, then write.
- `applyPatch(doc, operations)`: JSON Patch against a document.

## Drafts

`createDraftStore(storage)` keeps unsaved form input so a reload or navigation does not lose it. `storage` is anything with `getItem`, `setItem` and `removeItem`, so `localStorage` works as-is. Entries live under `yadad:draft:<formViewId>:<recordId or "new">` (change the prefix with the second argument). Storage errors are swallowed; a draft never breaks a form.

```ts
import { createDraftStore } from "@yadad/runtime";
const drafts = createDraftStore(window.localStorage);
```

When a draft is loaded, `restoreDraft(entity, draft)` fits it to the entity as it is now: values for fields the entity no longer has are dropped (and listed in `droppedFields`), `revisionChanged` says the entity revision moved since the draft was taken, and it returns `null` if nothing is left to restore. The renderer uses this for its `drafts` option.
