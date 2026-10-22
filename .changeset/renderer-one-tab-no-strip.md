---
"@yadad/renderer": minor
---

A dashboard with one visible tab renders no tab strip. A strip holding
a single tab repeats the page title (a consumer's "Home" appeared
twice) and pushes the content down on a phone. When the viewer sees
exactly one tab, the grid renders directly inside a region named by the
dashboard's title — its id when untitled — so the page keeps a named
landmark; two or more visible tabs render `layout.Tabs` as before. The
rule follows the tabs the **viewer** may see, not the document's: a
two-tab dashboard whose second tab is viewer-hidden now drops the strip
for that viewer too.
