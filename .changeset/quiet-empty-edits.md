---
"@yadad/runtime": patch
---

Empty updates are now a no-op in the memory and key-value adapters (the version is kept), `submitEdit` sends only changed fields and skips the save when nothing changed, and the HTTP adapter reports a 409 without a JSON body as a `RecordConflictError` instead of throwing a `TypeError`.
