# @yadad/renderer

The yadad React renderer: `FormRenderer`, `TableRenderer` and `DashboardRenderer` turn entity and view documents plus a registry and data source into working pages. Components are looked up by registry key; the renderer never imports a component.

React 19 peer dependency. See the repo [README](https://github.com/aggressive-stag/yadad) and [ARCHITECTURE.md](https://github.com/aggressive-stag/yadad/blob/main/ARCHITECTURE.md) for the design.

## Drafts

Drafts are opt-in. Pass `drafts` to `FormRenderer` (or to `DashboardRenderer`, which hands it to every embedded form) and unsaved input is saved after a pause (`debounceMs`, default 400) and restored the next time the form mounts:

```tsx
import { createDraftStore } from "@yadad/runtime";

const store = createDraftStore(window.localStorage);
<FormRenderer entity={entity} view={view} registry={registry} dataSources={dataSources} drafts={{ store, debounceMs: 400 }} />;
```

- Drafts are kept per form view id, for create forms (stored under `yadad:draft:<viewId>:new`). Only input typed in the current session is written back, and what is stored is what the form would save (hidden `clearWhenHidden` values are left out).
- A draft is cleared when the form is saved, when the user discards the restored values, or when every value has been emptied.
- If the documents changed since the draft was taken, values for fields the entity no longer has are dropped, and the form shows a "Restored unsaved changes" notice saying the form changed (entity revision differs) and/or that some values were left out. The restored values are never saved automatically.
