---
"@yadad/core": minor
"@yadad/renderer": minor
"@yadad/testing": patch
---

Datetime fields in the viewer's zone (RFC 0007): every renderer takes an optional `formatting?: { locale?, timeZone? }` and passes it down (dashboard pass it to each embedded view). A datetime Display gets `text` from `formatDateTime` plus the stored instant for a `<time dateTime>`; the Input shows the local wall time (`instantToLocal`) and stores the instant back (`localToInstant`, DST-safe: an ambiguous local time is the earlier instant). A registry without `fields.datetime` still shows an `ErrorSummary` naming the key. `@yadad/core` gains the optional `DatetimeDisplayExtras.text`; the mock Display renders `text ?? value`. The quick filter gains a from/to range for `datetime`: the control is a text box, the typed local times convert through `instantRangeBounds` (the `to` end covers its whole minute), read in the viewer's zone.
