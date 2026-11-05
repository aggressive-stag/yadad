# Screenshots

Every image the READMEs and RFCs ship, produced from the showcase in this repo with
the **real reference registry** — `baseRegistry` and the styles from
[`yadad-components`](https://github.com/aggressive-stag/yadad-components), not the
test mock. All data is the fictional fixtures in `apps/showcase/src` (a workout log,
a task list, a bookings app). Card 62b took these; keep them fresh when a card
changes what a screen looks like (plan §5: take the images from the code you commit
them with).

## Regenerating

The Playwright driver lives outside the repo (working rules: no Playwright
dependency here): `~/.hermes/evidence/ui-polish-2026-11/yadad/driver/` —
`docs-shots.js` (the stills) and `drag-frames3.js` (the editor drag sequence).

```sh
# 1. Build the components CSS the showcase imports, from the components repo checkout:
#    cd <yadad-components> && pnpm build:css   (emits dist/yadad-components.css)
# 2. Serve the showcase against the real registry:
cd apps/showcase
YADAD_REGISTRY_MODULE=<yadad-components>/registry/base.ts \
YADAD_REGISTRY_EXPORT=baseRegistry \
YADAD_REGISTRY_CSS=<yadad-components>/dist/yadad-components.css \
  pnpm exec vite --port 5331
# 3. Capture (needs a playwright-core install and its chromium-headless-shell elsewhere):
node ~/.hermes/evidence/ui-polish-2026-11/yadad/driver/docs-shots.js http://127.0.0.1:5331 docs/assets/screens
node ~/.hermes/evidence/ui-polish-2026-11/yadad/driver/drag-frames3.js http://127.0.0.1:5331 docs/assets/screens
# 4. Compress before committing (keeps every file under 200 KB):
pngquant --quality=70-90 --ext=.png --force --skip-if-larger docs/assets/screens/*.png
```

Verify the registry: `curl http://127.0.0.1:5331/@id/__x00__virtual:yadad-registry`
must name `yadad-components`, never `@yadad/testing` (a mock-registry shot is the
unstyled browser default and looks broken — that is how 62a caught itself).

## Inventory

Device scale factor 1. `<area>` names per the plan: the crop is an element
screenshot of the named showcase section unless the row says "viewport".

| Image | URL | State / action before the shot | Viewport |
| --- | --- | --- | --- |
| `hero-1280-light.png` | `/` | home, Views tab | 1280x800 viewport |
| `hero-390-light.png` | `/` | home, Views tab | 390x844 viewport (phone) |
| `form-hello-1280-light.png` | `/` | — | element: section `hello_form` |
| `table-tasks-1280-light.png` | `/` | — | element: section `tasks_table` |
| `dashboard-tasks-1280-light.png` | `/` | — | element: section `tasks_home` |
| `board-bookings-1280-light.png` | `/` | — | element: section `bookings_board` |
| `board-tasks-1280-light.png` | `/` | — | element: section `tasks_board` |
| `calendar-month-1280-light.png` | `/` | — | element: section `bookings_calendar` |
| `calendar-week-1280-light.png` | `/` | click Week in the calendar toolbar | element: section `bookings_calendar` |
| `detail-drill-1280-light.png` | `/` | open the first row of the drill-down table | element: section `drill_home` |
| `review-changes-1280-light.png` | `/#review` | — | element: section `review_changes` |
| `editor-table-1280-light.png` | `/` | click "Edit table: logged sets" | 1280x800 viewport |
| `editor-board-1280-light.png` | `/` | click "Edit board" (bookings) | 1280x800 viewport |
| `editor-drag-1-before-1280-light.png` | `/` | table editor open, Day first | 1280x800 viewport |
| `editor-drag-2-mid-1280-light.png` | `/` | grip focused, Day moved right one | same |
| `editor-drag-3-after-1280-light.png` | `/` | Day moved right twice | same |
| `theming-table-1280-light.png` | `/` | light color scheme | element: section `tasks_table` |
| `theming-table-1280-dark.png` | `/` | dark color scheme | element: section `tasks_table` |
| `theming-calendar-1280-dark.png` | `/` | dark color scheme | element: section `bookings_calendar` |
| `viewer-team-1280-role-owner.png` | `/` | "View as" Role set to **owner** | element: section `team_home` |
| `viewer-team-1280-role-viewer.png` | `/` | "View as" Role set to **viewer** | element: section `team_home` |
| `states-table-1280-light.png` | `/#states` | states page, tasks_table selected in the picker | element: `[data-states-page]` |

The drag frames move the **Day** column of the logged-sets table editor with the
keyboard (focus the grip, press Right) — one patch per press, the same move the
grip drag makes; the pointer drag is identical for a human. Frames are ordered
before / one step / two steps.
