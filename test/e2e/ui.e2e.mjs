// Browser tests for the loading states. Not part of `npm test` (needs a browser and a running dev server).
//
//   npx wrangler dev --port 8963 &
//   node test/e2e/ui.e2e.mjs http://127.0.0.1:8963
//
// Playwright is not a dependency of this project. Install it separately (`npm i -g playwright`) or
// point NODE_PATH at an installation. The audit API is replaced with canned responses in the
// scenarios that need timing control. Two real audits of https://example.com are used to build them.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let pw;
try {
  pw = require("playwright");
} catch {
  pw = require("/opt/node-tools/node_modules/playwright");
}
const { chromium, devices } = pw;
const base = process.argv[2] ?? "http://127.0.0.1:8963";

let failures = 0;
let checks = 0;
function ok(cond, name, extra = "") {
  checks++;
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
}

const iphone = { ...devices["iPhone 13"] };
delete iphone.defaultBrowserType;
const VIEWPORTS = [
  { name: "iPhone 13 (390px)", options: iphone },
  { name: "desktop (1280px)", options: { viewport: { width: 1280, height: 800 } } },
];

async function realReport(lang) {
  const res = await fetch(`${base}/api/audit`, { method: "POST", body: JSON.stringify({ url: "https://example.com", lang }) });
  if (!res.ok) throw new Error(`real audit failed: ${res.status}`);
  return res.json();
}

function gate() {
  let open;
  const promise = new Promise((r) => (open = r));
  return { promise, open };
}

/** Routes /api/audit to canned reports. Each call waits for the current gate. */
async function mockApi(page, reports, state) {
  await page.route("**/api/audit*", async (route) => {
    state.calls++;
    const body = route.request().postDataJSON();
    await state.gate.promise.catch(() => {});
    if (state.fail) return state.fail(route);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reports[body.lang] ?? reports.pl) });
  });
}

const measure = (page, scope) =>
  page.evaluate((s) => {
    const r = (sel) => {
      const n = document.querySelector(`${s} ${sel}`);
      const b = n.getBoundingClientRect();
      return { top: b.top + window.scrollY, height: b.height };
    };
    return {
      first: r(s === "#skeleton" ? ".sk-text" : "p.muted"),
      score: r(".score"),
      cats: r(".cats"),
      h2: r("h2"),
      form: document.querySelector("form").getBoundingClientRect().top + window.scrollY,
    };
  }, scope);

const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function freshPage(browser, options, extra = {}) {
  const ctx = await browser.newContext({ ...options, locale: "en-US", ...extra });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  return { ctx, page, errors };
}

(async () => {
  const reports = { pl: await realReport("pl"), en: await realReport("en") };
  const finalScore = reports.pl.score;
  const browser = await chromium.launch();

  for (const vp of VIEWPORTS) {
    console.log(`\n== ${vp.name}`);

    // 1. Loading state, blocked double submit, no layout jump, announcements, counter and meters.
    {
      const { ctx, page, errors } = await freshPage(browser, vp.options);
      const state = { calls: 0, gate: gate() };
      await mockApi(page, reports, state);
      await page.goto(base + "/");
      ok((await page.locator("html").getAttribute("lang")) === "pl", "default language is Polish with an English browser");
      await page.fill("#url", "example.com");
      const t = await page.evaluate(async () => {
        const t0 = performance.now();
        document.getElementById("go").click();
        await new Promise((r) => requestAnimationFrame(() => r()));
        return {
          ms: performance.now() - t0,
          skeleton: !document.getElementById("skeleton").hidden,
          loading: !document.getElementById("loading").hidden,
          disabled: document.getElementById("go").disabled,
          readOnly: document.getElementById("url").readOnly,
          label: document.getElementById("goText").textContent,
          spinner: !document.querySelector("#go .spin").hidden,
          busy: document.getElementById("result").getAttribute("aria-busy"),
          live: document.getElementById("live").textContent.trim(),
          text: document.getElementById("loadText").textContent,
        };
      });
      ok(t.ms < 100, "loading state shows within 100 ms of the click", `${t.ms.toFixed(1)} ms`);
      ok(t.skeleton && t.loading, "skeleton and loading note are visible");
      ok(t.disabled && t.readOnly, "button and field are locked");
      ok(t.label === "Sprawdzam stronę..." && t.spinner, "button shows busy label and spinner");
      ok(t.busy === "true", "aria-busy is true while loading");
      ok(t.live === "Trwa sprawdzanie", "live region announces the check", t.live);
      ok(t.text === "Pobieram stronę i analizuję ją, to zwykle trwa kilka sekund", "honest loading text");
      await page.locator("#url").press("Enter");
      await page.waitForTimeout(150);
      ok(state.calls === 1, "a second submit while busy sends no second request", `calls=${state.calls}`);
      ok((await overflowX(page)) <= 0, "no horizontal overflow while loading");
      const before = await measure(page, "#skeleton");
      await page.screenshot({ path: `/tmp/claude-0/e2e-loading-${vp.options.isMobile ? "m" : "d"}.png`, fullPage: false });
      state.gate.open();
      await page.waitForSelector("#report:not([hidden])");
      const early = await page.evaluate(() => ({
        score: Number(document.querySelector("#report .score strong").textContent),
        meter: document.querySelector("#report .meter i").getBoundingClientRect().width,
      }));
      await page.waitForTimeout(1800);
      const after = await measure(page, "#report");
      const late = await page.evaluate(() => ({
        score: Number(document.querySelector("#report .score strong").textContent),
        meter: document.querySelector("#report .meter i").getBoundingClientRect().width,
        loadingHidden: document.getElementById("loading").hidden && document.getElementById("skeleton").hidden,
        disabled: document.getElementById("go").disabled,
        busy: document.getElementById("result").getAttribute("aria-busy"),
        live: document.getElementById("live").textContent.trim(),
        scrollY: window.scrollY,
      }));
      ok(early.score < finalScore && late.score === finalScore, "score counts up to the final value", `${early.score} -> ${late.score}`);
      ok(early.meter < late.meter, "category bars fill up", `${early.meter.toFixed(0)} -> ${late.meter.toFixed(0)} px`);
      ok(late.loadingHidden && !late.disabled && late.busy === "false", "loading state is gone and the form is unlocked");
      ok(late.live === `Gotowe, ocena ${finalScore} na 100`, "live region announces the result", late.live);
      const d = (k, f) => Math.abs(before[k][f] - after[k][f]);
      ok(d("first", "top") <= 3 && d("first", "height") <= 3, "first row does not move", `dTop=${d("first", "top").toFixed(1)} dH=${d("first", "height").toFixed(1)}`);
      ok(d("score", "top") <= 3 && d("score", "height") <= 3, "score row does not move", `dTop=${d("score", "top").toFixed(1)} dH=${d("score", "height").toFixed(1)}`);
      ok(d("cats", "top") <= 3 && d("cats", "height") <= 3, "category cards do not move or resize", `dTop=${d("cats", "top").toFixed(1)} dH=${d("cats", "height").toFixed(1)}`);
      ok(d("h2", "top") <= 3, "heading below the cards does not move", `dTop=${d("h2", "top").toFixed(1)}`);
      ok(Math.abs(before.form - after.form) <= 1, "form does not move");
      ok(late.scrollY <= 1, "page was not scrolled without need", `scrollY=${late.scrollY}`);
      ok((await overflowX(page)) <= 0, "no horizontal overflow with the report");

      // Scrolling down and up (touch gesture on the phone, wheel on desktop).
      if (vp.options.hasTouch) {
        const cdp = await ctx.newCDPSession(page);
        // A real touch drag: finger down, move in small steps, finger up.
        const swipe = async (yDistance) => {
          const x = 200;
          const y0 = yDistance < 0 ? 560 : 150;
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] });
          for (let i = 1; i <= 12; i++) {
            await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y0 + (yDistance * i) / 12 }] });
            await page.waitForTimeout(16);
          }
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await page.waitForTimeout(600);
        };
        await swipe(-400);
        const down = await page.evaluate(() => window.scrollY);
        await swipe(300);
        const up = await page.evaluate(() => window.scrollY);
        ok(down > 100 && up < down, "touch scroll works down and up", `down=${down} up=${up}`);
      } else {
        await page.mouse.wheel(0, 600);
        await page.waitForTimeout(200);
        const down = await page.evaluate(() => window.scrollY);
        await page.mouse.wheel(0, -400);
        await page.waitForTimeout(200);
        const up = await page.evaluate(() => window.scrollY);
        ok(down > 100 && up < down, "wheel scroll works down and up", `down=${down} up=${up}`);
      }
      ok(errors.length === 0, "no console errors", errors.join(" | "));
      await ctx.close();
    }

    // 2. Slow site: message after 8 s, error with retry after the limit (fake clock).
    {
      const { ctx, page, errors } = await freshPage(browser, vp.options);
      await page.clock.install();
      const state = { calls: 0, gate: gate() };
      await mockApi(page, reports, state);
      await page.goto(base + "/");
      await page.fill("#url", "example.com");
      await page.click("#go");
      await page.clock.fastForward(7500);
      ok((await page.textContent("#loadText")).startsWith("Pobieram stronę"), "still the normal text before 8 s");
      await page.clock.fastForward(1000);
      ok((await page.textContent("#loadText")) === "Strona odpowiada wolno, jeszcze chwilę", "slow notice after 8 s");
      ok((await page.textContent("#live")).trim() === "Strona odpowiada wolno, jeszcze chwilę", "slow notice is announced");
      await page.clock.fastForward(12500);
      await page.waitForSelector("#error:not([hidden])");
      ok((await page.textContent("#errorMsg")) === "Sprawdzanie trwało zbyt długo i zostało przerwane.", "timeout error after the limit");
      const retry = page.locator("#retry");
      const box = await retry.boundingBox();
      ok(await retry.isVisible() && box.height >= 44, "retry button is visible and at least 44 px high", `${box?.height}px`);
      ok(!(await page.locator("#go").isDisabled()) && (await page.locator("#loading").isHidden()), "form unlocked after the error");
      ok((await page.locator("#error .icon").isVisible()), "error has an icon");
      ok((await overflowX(page)) <= 0, "no horizontal overflow in the error state");
      // Retry goes through.
      state.gate = gate();
      state.gate.open();
      await retry.click();
      await page.waitForSelector("#report:not([hidden])");
      ok(state.calls === 2, "retry sends a new request", `calls=${state.calls}`);
      ok(errors.length === 0, "no console errors", errors.join(" | "));
      await ctx.close();
    }

    // 3. Language switch with a visible report: dimmed old report, overlay note, scroll position kept.
    {
      const { ctx, page, errors } = await freshPage(browser, vp.options);
      const state = { calls: 0, gate: gate() };
      state.gate.open();
      await mockApi(page, reports, state);
      await page.goto(base + "/");
      await page.fill("#url", "example.com");
      await page.click("#go");
      await page.waitForSelector("#report:not([hidden])");
      await page.waitForTimeout(1500);
      await page.evaluate(() => window.scrollTo(0, 400));
      await page.waitForTimeout(100);
      const headTop = () => page.evaluate(() => document.querySelector("#report h2").getBoundingClientRect().top);
      const y0 = await headTop();
      state.gate = gate();
      await page.evaluate(() => document.querySelector('[data-lang="en"]').click());
      await page.waitForTimeout(300);
      const mid = await page.evaluate(() => ({
        refreshing: document.getElementById("report").classList.contains("refreshing"),
        opacity: getComputedStyle(document.getElementById("report")).opacity,
        loading: !document.getElementById("loading").hidden,
        skeleton: !document.getElementById("skeleton").hidden,
        reportVisible: !document.getElementById("report").hidden,
        note: document.getElementById("loadText").textContent,
        noteTop: document.querySelector(".load-text").getBoundingClientRect().top,
      }));
      mid.y = await headTop();
      ok(mid.refreshing && mid.reportVisible && Number(mid.opacity) < 0.6, "old report stays, dimmed", `opacity=${mid.opacity}`);
      ok(mid.loading && !mid.skeleton, "loading note over the old report, no skeleton");
      ok(mid.note.startsWith("Fetching the page"), "loading note is already in the new language");
      ok(mid.noteTop >= 0 && mid.noteTop < 100, "loading note stays in view while scrolled", `top=${mid.noteTop.toFixed(0)}`);
      ok(Math.abs(mid.y - y0) <= 1, "content stays where it was while loading (heading position)", `${y0} -> ${mid.y}`);
      state.gate.open();
      await page.waitForFunction(() => document.querySelector("#report h2")?.textContent.startsWith("Things to fix"));
      await page.waitForTimeout(1500);
      const y1 = await headTop();
      ok(Math.abs(y1 - y0) <= 1, "content stays where it was after the new report", `${y0} -> ${y1}`);
      ok((await page.locator("html").getAttribute("lang")) === "en", "html lang switched");
      ok(errors.length === 0, "no console errors", errors.join(" | "));
      await ctx.close();
    }

    // 4. Error states: blocked address, rate limit, network failure (Polish and English).
    {
      const cases = [
        { name: "blocked address", fail: (r) => r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "blocked_target", message: "Ten adres IP jest prywatny, lokalny lub zarezerwowany." } }) }), msg: "Ten adres IP jest prywatny, lokalny lub zarezerwowany.", hint: "Wpisz publiczny adres strony, na przykład przyklad.pl.", retry: false },
        { name: "rate limit", fail: (r) => r.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { code: "rate_limited", message: "Zbyt wiele zapytań. Odczekaj minutę i spróbuj ponownie." } }) }), msg: "Zbyt wiele zapytań. Odczekaj minutę i spróbuj ponownie.", hint: "Odczekaj minutę i spróbuj ponownie.", retry: true },
        { name: "slow site (server timeout)", fail: (r) => r.fulfill({ status: 504, contentType: "application/json", body: JSON.stringify({ error: { code: "timeout", message: "Strona nie odpowiedziała na czas." } }) }), msg: "Strona nie odpowiedziała na czas.", hint: "Strona mogła być chwilowo niedostępna albo bardzo wolna. Spróbuj ponownie za chwilę.", retry: true },
        { name: "network failure", fail: (r) => r.abort("failed"), msg: "Nie udało się połączyć z narzędziem. Sprawdź połączenie z internetem i spróbuj ponownie.", hint: "Sprawdź połączenie z internetem i spróbuj ponownie.", retry: true },
      ];
      for (const c of cases) {
        const { ctx, page } = await freshPage(browser, vp.options);
        const state = { calls: 0, gate: gate(), fail: c.fail };
        state.gate.open();
        await mockApi(page, reports, state);
        await page.goto(base + "/");
        await page.fill("#url", "example.com");
        await page.click("#go");
        await page.waitForSelector("#error:not([hidden])");
        ok((await page.textContent("#errorMsg")) === c.msg, `${c.name}: message`);
        ok((await page.textContent("#errorHint")) === c.hint, `${c.name}: hint`);
        ok((await page.locator("#retry").isVisible()) === c.retry, `${c.name}: retry button ${c.retry ? "shown" : "hidden"}`);
        ok((await page.textContent("#live")).includes(c.msg), `${c.name}: announced`);
        ok((await overflowX(page)) <= 0, `${c.name}: no horizontal overflow`);
        await ctx.close();
      }
    }

    // 5. Reduced motion: no animations, final values at once.
    {
      const { ctx, page, errors } = await freshPage(browser, vp.options, { reducedMotion: "reduce" });
      const state = { calls: 0, gate: gate() };
      await mockApi(page, reports, state);
      await page.goto(base + "/");
      await page.fill("#url", "example.com");
      await page.click("#go");
      const anim = await page.evaluate(() => {
        const name = (sel) => getComputedStyle(document.querySelector(sel)).animationName;
        const bar = getComputedStyle(document.querySelector(".load-text .bar i"));
        return {
          spinner: name("#go .spin"),
          bar: bar.animationName,
          barWidth: bar.width,
          skeleton: name("#skeleton .sk-score"),
        };
      });
      ok(anim.spinner === "none" && anim.bar === "none" && anim.skeleton === "none", "loading animations are off", JSON.stringify(anim));
      ok(parseFloat(anim.barWidth) > 0, "progress bar is a static bar");
      state.gate.open();
      await page.waitForSelector("#report:not([hidden])");
      const r = await page.evaluate(() => ({
        score: Number(document.querySelector("#report .score strong").textContent),
        rise: getComputedStyle(document.querySelector("#report .rv")).animationName,
        fill: getComputedStyle(document.querySelector("#report .meter i")).animationName,
        meter: document.querySelector("#report .meter i").getBoundingClientRect().width,
      }));
      ok(r.score === finalScore, "score is final at once");
      ok(r.rise === "none" && r.fill === "none" && r.meter > 0, "report animations are off, bars are filled");
      ok(errors.length === 0, "no console errors", errors.join(" | "));
      await ctx.close();
    }
  }

  await browser.close();
  console.log(`\n${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
