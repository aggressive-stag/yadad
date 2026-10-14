---
"@yadad/runtime": minor
---

`createHttpAdapter` accepts an optional `onUnauthorized` hook, called whenever a response is 401, so a host can redirect to sign-in. The call still rejects with `UnauthorizedError`.
