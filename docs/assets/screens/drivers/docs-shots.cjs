// Card 62b docs-screenshot driver (UI-polish round 2026-11).
// Usage: node docs-shots.cjs <base> <outdir>
// Captures the images docs/assets/screens/ ships, per plan S5. Screenshots only,
// no probes. Viewports: 1280x800 (light, plus dark twins for the theming pair)
// and 390x844 (hero phone). deviceScaleFactor 1.
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const BASE = process.argv[2] || "http://127.0.0.1:5331";
const OUT = process.argv[3] || ".";
const EXEC = process.env.CHROME_EXE || "/home/aggro/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell";

// {file, url, act, shot (selector|null=viewport), w, h, scheme, scroll}
const J = [];
const S = (file, url, extra = {}) => J.push({ file, url, ...extra });
const sec = (name) => `main > section[aria-label="${name}"]`;

// README: hero pair + "what you write, what you get" per view type
S("hero-1280-light.png", "/", { w: 1280, h: 800, scheme: "light", shot: null });
S("hero-390-light.png", "/", { w: 390, h: 844, scheme: "light", shot: null });
S("form-hello-1280-light.png", "/", { w: 1280, h: 800, scheme: "light", shot: sec("hello_form") });
S("table-tasks-1280-light.png", "/", { w: 1280, h: 800, scheme: "light", shot: sec("tasks_table") });
S("dashboard-tasks-1280-light.png", "/", { w: 1280, h: 800, scheme: "light", shot: sec("tasks_home") });
S("board-bookings-1280-light.png", "/", { w: 1280, h: 800, scheme: "light", shot: sec("bookings_board") });
S("calendar-month-1280-light.png", "/", { w: 1280, h: 800, scheme: "light", shot: sec("bookings_calendar") });
S("detail-drill-1280-light.png", "/", {
  w: 1280, h: 800, scheme: "light",
  act: async (p) => { await p.locator(sec("drill_home") + " [data-yadad-row-open] button").first().click(); },
  shot: sec("drill_home"),
});
S("review-changes-1280-light.png", "/#review", { w: 1280, h: 800, scheme: "light", shot: sec("review_changes") });

// renderer README: each view type (form/table/board/calendar/detail reuse the README set; dashboard + calendar week added)
S("calendar-week-1280-light.png", "/", {
  w: 1280, h: 800, scheme: "light",
  act: async (p) => { await p.locator(sec("bookings_calendar") + ' button', { hasText: /^Week$/i }).first().click(); },
  shot: sec("bookings_calendar"),
});
S("board-tasks-1280-light.png", "/", { w: 1280, h: 800, scheme: "light", shot: sec("tasks_board") });

// editor README: the editor at 1280 (full viewport; call-outs as a list in the README)
S("editor-table-1280-light.png", "/", {
  w: 1280, h: 800, scheme: "light",
  act: async (p) => { await p.locator(sec("training") + ' button', { hasText: "Edit table: logged sets" }).click(); },
  shot: null,
});
S("editor-board-1280-light.png", "/", {
  w: 1280, h: 800, scheme: "light",
  act: async (p) => { await p.locator(sec("bookings_board") + ' button', { hasText: "Edit board" }).click(); },
  shot: null,
});

// theme README: same view, two token sets
S("theming-table-1280-light.png", "/", { w: 1280, h: 800, scheme: "light", shot: sec("tasks_table") });
S("theming-table-1280-dark.png", "/", { w: 1280, h: 800, scheme: "dark", shot: sec("tasks_table") });
S("theming-calendar-1280-dark.png", "/", { w: 1280, h: 800, scheme: "dark", shot: sec("bookings_calendar") });

// testing README: the states page (what a state-check run covers)
S("states-table-1280-light.png", "/#states", {
  w: 1280, h: 800, scheme: "light",
  act: async (p) => {
    const sel = p.locator('[data-states-page] select').first();
    await sel.waitFor({ timeout: 5000 });
    const opts = await sel.locator("option").allTextContents();
    const want = opts.find((t) => /tasks_table/i.test(t)) || opts[0];
    await sel.selectOption({ label: want });
    await p.waitForTimeout(700);
  },
  shot: "[data-states-page]",
});

// editor drag sequence (3 frames) on the dashboard layout editor grid, if a grip exists
async function dragFrames(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light", deviceScaleFactor: 1, hasTouch: false });
  const p = await ctx.newPage();
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  await p.locator(sec("training") + ' button', { hasText: "Edit layout" }).click();
  await p.waitForTimeout(900);
  const grip = p.locator('[data-part="grip"], [draggable="true"], [data-yadad="grip"]').first();
  if (!(await grip.count())) { console.log("drag: no grip, skipping"); await ctx.close(); return; }
  const gb = await grip.boundingBox();
  if (!gb) { await ctx.close(); return; }
  const target = p.locator('[data-part="cell"], [data-part="grid"]').nth(3);
  const tb = await target.boundingBox().catch(() => null);
  await p.screenshot({ path: path.join(OUT, "editor-drag-1-before-1280-light.png") });
  if (tb) {
    await p.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
    await p.mouse.down();
    await p.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 12 });
    await p.waitForTimeout(300);
  }
  await p.screenshot({ path: path.join(OUT, "editor-drag-2-mid-1280-light.png") });
  if (tb) { await p.mouse.up(); }
  await p.waitForTimeout(700);
  const after = await p.screenshot();
  fs.writeFileSync(path.join(OUT, "editor-drag-3-after-1280-light.png"), after);
  const before = fs.readFileSync(path.join(OUT, "editor-drag-1-before-1280-light.png"));
  fs.writeFileSync(path.join(OUT, "drag-frames.json"), JSON.stringify({ moved: !before.equals(after) }));
  await ctx.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  let ok = 0, bad = 0;
  for (const s of J) {
    const ctx = await browser.newContext({ viewport: { width: s.w || 1280, height: s.h || 800 }, colorScheme: s.scheme || "light", deviceScaleFactor: 1, hasTouch: false });
    const p = await ctx.newPage();
    try {
      await p.goto(BASE + s.url, { waitUntil: "networkidle" });
      await p.waitForTimeout(700);
      if (s.act) { await s.act(p); await p.waitForTimeout(400); }
      const el = s.shot ? p.locator(s.shot).first() : null;
      if (el && (await el.count())) {
        await el.scrollIntoViewIfNeeded();
        await p.waitForTimeout(200);
        await el.screenshot({ path: path.join(OUT, s.file) });
      } else {
        await p.screenshot({ path: path.join(OUT, s.file) });
        if (s.shot) console.log(`  WARN ${s.file}: selector missed, viewport shot used`);
      }
      console.log(`${s.file} ok`);
      ok++;
    } catch (e) {
      console.log(`${s.file} ERROR ${String(e.message).slice(0, 120)}`);
      bad++;
    } finally {
      await ctx.close();
    }
  }
  await dragFrames(browser);
  await browser.close();
  console.log(`DOCS-SHOTS done ok=${ok} bad=${bad}`);
})();
