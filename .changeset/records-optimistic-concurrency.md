---
"@yadad/core": minor
---

`DataRecord` now carries an opaque `version`, `WriteMeta` accepts `baseVersion`, `DataAdapter.delete` accepts write metadata, and `DataAdapter.batch` creates and deletes records atomically. Adapter failures are typed `AdapterError` subclasses (`RecordNotFoundError`, `RecordConflictError`, `RecordValidationError`, `UnauthorizedError`, `ForbiddenError`) with the records-protocol error codes.
