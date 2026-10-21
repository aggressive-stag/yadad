---
"@yadad/runtime": patch
"@yadad/renderer": patch
---

A refused save keeps the server's own words. When the records host
answers 400 with the protocol's `errors[]`, every entry now becomes an
error with its own `message`, `hint` and `path`: an entry at
`/values/<field>` marks that field (it shows the message and gets
`aria-invalid`), and an entry at `""` shows the server's hint at form
level. Previously the form appended its generic "Reload and try again."
after the server's precise message — advice that fixes nothing when the
value itself is wrong — and a located field was never marked, because
the protocol's pointer into the request body was not the path the form
matches fields on. The generic line stays for failures with no protocol
body (a network drop, a 5xx, an empty 400); conflict, not-found,
unauthorized and forbidden keep their own mappings. `serverValidationIssues`
is the shared mapping, used by both the form and the record-action
failures.
