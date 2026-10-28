---
"@yadad/renderer": patch
---

Keep focus on a record's action button when a second reload rebuilds it. After a press the focus return used to end as soon as one restore survived a render; a reload that landed later (a sibling widget refreshing after `onChanged`, or a second fetch of the same view) swapped the control again and dropped focus to the page. The restore now stays armed for a short window, follows the control it last focused, and ends at once when the viewer presses a key or the pointer, or moves focus elsewhere.
