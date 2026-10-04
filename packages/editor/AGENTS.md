# AGENTS.md (editor)

Package rules on top of the root `AGENTS.md`.

- **Owns:** authoring. It emits JSON Patch operations against entity and view documents, builds property panels from each registry entry's `optionsSchema`, and handles dashboard drag/resize.
- **Imports:** `@yadad/core` and `@yadad/runtime`. It asks the registry about components and never imports one.
- **Drag and grid:** react-grid-layout v2 and `@dnd-kit/react` are accepted dependencies for this package only, and only behind the `editor/dnd` adapter. `@dnd-kit/react` is pre-1.0, so keep it swappable.
- **One writer:** the editor writes documents, never records.
- **Edits:** additive edits are plain patches. Destructive edits (deleting a field, changing its type) go through explicit transforms, and each save produces a new `revision`.
- **Commit scope:** `editor`.
