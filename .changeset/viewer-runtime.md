---
"@yadad/runtime": minor
---

Viewer facts and per-record permissions (RFC 0006). `resolveViewer(document, input)` builds the `ResolvedViewer` renderers take, with `issues` for values it had to ignore. `evaluateCondition` takes an optional `viewer` (a `viewerIn` leaf reads it; with none it is false), as do `evaluateFormRules` and `applyFormRules`. New pure helpers: `findViewerDocument`, `evaluateViewerCondition`, `visibleColumns`, `columnEditable`, `viewEditable`, `rowActionVisible`, `visibleTabs`, `visibleItems`, `canUpdate`, `viewerFactsRead`, `viewerLeavesRead`. The memory and key-value adapters take `recordPermissions`, carry the result as `can` on every record they return and refuse updates and deletes with a `ForbiddenError`; the HTTP adapter passes a valid `can` through and drops a malformed one; every adapter rejects a filter containing a `viewerIn` leaf with a `RecordValidationError` at `/filter`.

`viewStates` gains a `viewer:<factId>` axis per viewer fact a view reads, a `permission` axis (`unrestricted`, `record-locked`) on views with an edit surface, and one extra `viewer-not-provided` state. Every `ViewState` now has a `viewer: ResolvedViewer` (and `omitViewer: true` on the extra state); code that builds a `ViewState` by hand must add `viewer`. Views that read no fact and have no edit surface produce the same states as before.
