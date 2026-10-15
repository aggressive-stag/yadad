---
"@yadad/testing": minor
---

The mock registry now has a `layout.Calendar`: a plain, semantic month or week grid (day cells named by their full date, entries as buttons, a "Move to day…" control per movable entry, a polite live region), with no drag. The contract kit gains `layout.Calendar` checks (grid and day names, week, navigation and mode switcher, entries and `onOpenEntry`, "Move to day…" and `onMove`, live region and `aria-busy`, axe). The checks run only when the registry has a calendar, because the key is optional.
