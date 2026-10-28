---
"@yadad/runtime": minor
"@yadad/renderer": minor
---

Boards put the "no value" column last and hide it while it has no cards (`boardColumns` and `boardRecordColumns` return it last; the new `shownBoardColumns` drops it when empty). It was first, even when empty. The calendar scrolls today's cell into view once when it first loads. A direct press on a record action no longer loses its focus return when an unrelated render commits before the action's pending state does. The packages' READMEs now say a built yadad app makes no requests to yadad infrastructure.
