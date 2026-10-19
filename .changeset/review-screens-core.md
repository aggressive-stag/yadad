---
"@yadad/core": minor
---

Review screens, part one (RFC 0007). `specVersion` is now 6; older documents stay valid and `migrate()` only stamps the new version.

What you change when you upgrade:

- `fields.datetime` is a new **optional** registry key, so existing component sets still type-check. A document that uses a `datetime` field with a registry that lacks it shows an error naming the key. `Registry.fields` is now `RegistryFields<N>`.
- `Page.total` is now **optional** and `Page` gains `next?: string | null`, an opaque cursor. Code that reads `page.total` as a number must handle `undefined`.
- `Query.page` is now a **union**: `{ offset, limit }` or `{ cursor, limit }`. Code that reads `query.page.offset` must narrow first (`"cursor" in query.page`).
- `RecordPermissions` gains `actions?: Readonly<Record<string, boolean>>` (action id to allowed; only `false` restricts).
- `DataAdapter` gains an **optional** `act(entity, id, action, request)` method, with the `ActionRequest` type. Existing adapters need no change.

What is new:

- A `datetime` field type: an instant stored as `YYYY-MM-DDTHH:MM:SS.sssZ` (UTC, milliseconds, `Z`), with `min` and `max`. It cannot be a calendar `dateField` or a board `groupBy`.
- Entity `actions` (id, label, `confirm`, typed `input`, `visibleWhen`) and view `recordActions` on tables, boards and calendars, with the validator's shape, reference and viewer-fact checks.
- A table column `compare` (`{ to: "previousRow" | "nextRow" }` or `{ field }`) for text fields.
- Optional registry types: `layout.Dialog` (`DialogProps`), `RecordActionItem` with `actions` on `TableRow`, `BoardCard` and `CalendarEntry`, `TableProps.actionsLabel`, and `diff` (`DiffSegment`) on the text `Display`.
- `recordJsonSchema` emits `format: "date-time"` and a canonical pattern for `datetime` fields; `describeContract` lists all of the above.
