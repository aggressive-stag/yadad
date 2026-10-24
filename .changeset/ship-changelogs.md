---
"@yadad/core": patch
"@yadad/runtime": patch
"@yadad/renderer": patch
"@yadad/editor": patch
"@yadad/testing": patch
---

Ship CHANGELOG.md in every published tarball. The `files` arrays shipped `dist` and `src` only, so a consumer upgrading from the registry could not read the upgrade notes — only `@yadad/components` shipped its changelog.
