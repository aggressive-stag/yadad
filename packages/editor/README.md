# @yadad/editor

The yadad editors: `EntityFieldsEditor`, `FormViewEditor`, `TableViewEditor` and `DashboardLayoutEditor`. Every change is a JSON Patch against a document (undo/redo via the patch log); property panels come from an exhaustive per-field-type map; dashboard drag and resize are hand-written over CSS grid with full keyboard support.

React 19 peer dependency. See the repo [README](https://github.com/aggressive-stag/yadad) and [ARCHITECTURE.md](https://github.com/aggressive-stag/yadad/blob/main/ARCHITECTURE.md) for the design.
