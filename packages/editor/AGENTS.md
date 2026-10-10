# AGENTS.md (editor)

Package rules on top of the root `AGENTS.md`.

- **Owns:** authoring. It emits JSON Patch operations against entity and view documents, builds property panels from an exhaustive per-field-type map, and handles dashboard drag/resize.
- **Imports:** `@yadad/core` and `@yadad/runtime`. It asks the registry about components and never imports one.
- **Drag and grid:** hand-written over CSS grid — pointer drag, corner resize and arrow keys; no grid or dnd library.
- **One writer:** the editor writes documents, never records.
- **Edits:** additive edits are plain patches. Destructive edits (deleting a field, changing its type) go through explicit transforms, and each save produces a new `revision`.
- **Commit scope:** `editor`.
