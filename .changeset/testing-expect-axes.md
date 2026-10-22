---
"@yadad/testing": minor
---

`checkViewStates` / `checkViewStatesReport` gain `expectAxes`. A table
whose last editable column disappears in a refactor loses its
`permission` axis — and every locked-record state with it — and stays
green with fewer states. Name the axes a view must cover and each
missing id now fails as an `axis-missing` problem on the first result.
A consumer pins its critical axes and the grid can no longer shrink
silently.
