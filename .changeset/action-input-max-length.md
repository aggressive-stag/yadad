---
"@yadad/runtime": patch
"@yadad/testing": patch
---

`validateRecord` now enforces a text field's `maxLength` (RFC 0008 item 13c), counting code points, so record forms and action input (`validateActionInput`) refuse an over-long value before the round trip. The mock registry's text input carries `maxLength`. `recordJsonSchema` does not emit `maxLength` yet; docs/records-protocol.md lists it as a known difference.
