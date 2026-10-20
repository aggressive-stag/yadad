---
"@yadad/renderer": minor
"@yadad/testing": minor
---

Record actions on tables (RFC 0007): a view's `recordActions` now reach the table on their own — no host prop. `useRecordActions` builds each row's `RecordActionItem`s with `availableActions`, presses run `adapter.act` with the record's last-read version as the guard, the row's buttons go gray while its record is in flight, a success announces "<label> done" and reloads the page, and a 403/409/404 shows the view's ErrorSummary and reloads. A data source that cannot run actions (`act` absent) or an action that needs a dialog the registry does not provide replaces the view with an ErrorSummary (`/dataSource`, `/layout/Dialog`). Until the action dialog lands, an action with `confirm` or `input` is not offered — it must never run without its confirmation. Boards and calendars reuse the same hook in their next cards. `@yadad/testing`: the state adapter now answers `act` like the working source it pretends to be (guard order as the memory adapter; writes obey the refused/conflict matrix), so views with `recordActions` state-check like every other view.
