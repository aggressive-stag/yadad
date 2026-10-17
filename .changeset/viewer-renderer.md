---
"@yadad/renderer": minor
---

Every renderer (form, table, calendar, board, dashboard) takes an optional `viewer` prop (RFC 0006) and stops offering what the viewer may not use. Viewer-hidden form items, table columns, dashboard tabs and widgets are not rendered; in-place editing, "Move to…" and drag are withheld when `editableWhen` is false or the record's `can.update` is `false`; a `rowAction` is withheld while its `visibleWhen` is false. Dashboards pass the viewer to the views they embed, and row actions to the views they open. Without a `viewer` prop, a renderer that has the document set (new optional `DocumentSet.viewer`) uses the viewer document's defaults; a bare view that reads a viewer fact shows an `ErrorSummary` (`/viewer`, `required`). A dashboard with no visible tab says "There is nothing to show you here." A 403 is handled as before and refreshes `can`. Documents that read no viewer fact behave as before.
