---
"@yadad/runtime": minor
---

One `MovePlan` for every move: `moveDay` and `moveCard` return the same union (`none` / `blocked` / `update`, exported from `@yadad/runtime`). Board's `"rejected"` case is now `blocked` with `reason: "other"` — a breaking discriminant change for anyone switching on move plans, made deliberately so the two views' "we will not write" answers stay one design instead of two.
