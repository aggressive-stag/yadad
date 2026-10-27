---
"@yadad/testing": minor
---

New test helpers `waitForRows(container, { view?, count?, rowSelector? })` and `waitForSettled(container)`. They wait (Testing Library `waitFor`, no timeouts) until nothing under the container reports busy (`aria-busy`, a loading quick filter, the series loading marker) and, for rows, until the view's rows are drawn. Use them instead of asserting right after a render or an action that loads.
