---
"@yadad/core": minor
---

`specVersion` is now 9. Version 9 is the carrier for the accepted items of RFC 0010; `migrate()` upgrades version-8 documents with an identity step that only changes the stamp, so every existing document stays valid. New documents should say `specVersion: 9`.
