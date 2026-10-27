---
"@yadad/core": patch
---

`recordJsonSchema` now emits a `text` field's `maxLength`, so a server validating with the published record schema refuses the over-long strings the runtime already refuses.
