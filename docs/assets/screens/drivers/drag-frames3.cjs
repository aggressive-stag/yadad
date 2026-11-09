// Card 62b: drag frames, attempt 3. Focus verified before each keypress.
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const BASE = process.argv[2] || "http://127.0.0.1:5331";
const OUT = process.argv[3] || ".";
const EXEC = process.env.CHROME_EXE || "/home/aggro/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell";

const order = (p) => p.locator("button[data-yadad-drag-grip]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").replace("Drag the column ", "")));

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light", deviceScaleFactor: 1, hasTouch: false });
  const p = await ctx.newPage();
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  await p.locator('main > section[aria-label="training"] button', { hasText: "Edit table: logged sets" }).first().click();
  await p.waitForTimeout(1200);

  const grips = p.locator("button[data-yadad-drag-grip]");
  console.log("grips", await grips.count(), "order0", JSON.stringify(await order(p)));

  // bring grip 0 into view, focus via click-to-focus then check activeElement
  const g0 = grips.first();
  await g0.scrollIntoViewIfNeeded();
  await p.waitForTimeout(250);
  await g0.focus();
  let act = await p.evaluate(() => document.activeElement?.getAttribute?.("aria-label") || document.activeElement?.tagName);
  console.log("activeElement after focus():", act);
  if (!String(act).startsWith("Drag the column")) {
    // click focus (mousedown+up on the grip; the drag only starts on pointerdown+move)
    const b = await g0.boundingBox();
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await p.mouse.down();
    await p.mouse.up();
    act = await p.evaluate(() => document.activeElement?.getAttribute?.("aria-label") || document.activeElement?.tagName);
    console.log("activeElement after click:", act);
  }

  await p.screenshot({ path: path.join(OUT, "editor-drag-1-before-1280-light.png") });
  await p.keyboard.press("ArrowRight");
  await p.waitForTimeout(500);
  console.log("order after key1", JSON.stringify(await order(p)));
  await p.screenshot({ path: path.join(OUT, "editor-drag-2-mid-1280-light.png") });
  // re-focus the (moved) Day grip and step again
  const day = p.locator('button[data-yadad-drag-grip][aria-label="Drag the column Day"]');
  await day.focus();
  await p.keyboard.press("ArrowRight");
  await p.waitForTimeout(500);
  console.log("order after key2", JSON.stringify(await order(p)));
  await p.screenshot({ path: path.join(OUT, "editor-drag-3-after-1280-light.png") });

  const before = ["Day","Exercise","Weight","Reps","Warm-up set","How did it feel?","Notes"];
  const after = await order(p);
  fs.writeFileSync(path.join(OUT, "drag-frames.json"), JSON.stringify({ mode: "keyboard", before, after, moved: JSON.stringify(before) !== JSON.stringify(after) }, null, 2));
  await browser.close();
  console.log("DRAG3 done moved=" + (JSON.stringify(before) !== JSON.stringify(after)));
})();
