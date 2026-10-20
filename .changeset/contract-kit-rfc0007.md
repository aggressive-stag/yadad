---
"@yadad/testing": minor
---

The contract kit now checks the RFC 0007 components: a datetime Display must show the given text on an element carrying the stored instant, a text Display must mark a diff's additions and removals with `ins` and `del`, a Table must draw each row's actions as buttons named by their labels, disabled while pending, under an `actionsLabel`, and the Dialog must be modal, named by its label, and take focus on open and return it on close. Checks are only registered for the keys a registry provides. `describeActionScenarios` drives the dialog flows through one line of host wiring — press an action, answer the confirm and the input, and make the source refuse with 403 or go stale with 409 — found by role and accessible name, with no renderer import in the kit.
