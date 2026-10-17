---
"@yadad/runtime": patch
---

`viewStates` no longer lists impossible viewer combinations: "1 record locked" is left out of states with no records, a dashboard tab is only listed for viewers who can see it (a viewer who sees no tab gets one state, on the first tab), and the "viewer not provided" state sits on the first tab the default viewer sees. The permission axis value "no record locked" is now called "records open".
