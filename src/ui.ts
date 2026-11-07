import { DEFAULT_LANG, dictionary, LANGS, type Lang, type UiKey } from "./i18n";

/** The whole UI is one static page. Report data is only ever inserted with textContent. */
export function renderUi(nonce: string, lang: Lang = DEFAULT_LANG): string {
  const ui = dictionary(lang).ui;
  const t = (key: UiKey) => escapeHtml(ui[key]);
  // Both languages are embedded, so the switch works without another request for the page.
  const texts = Object.fromEntries(
    LANGS.map((l) => [l, { ...dictionary(l).ui, disclaimer: dictionary(l).disclaimer }]),
  );
  const pressed = (l: Lang) => (l === lang ? "true" : "false");

  return PAGE.replaceAll("__NONCE__", nonce)
    .replaceAll("__LANG__", lang)
    .replaceAll("__META_TITLE__", t("metaTitle"))
    .replaceAll("__META_DESCRIPTION__", t("metaDescription"))
    .replaceAll("__HEADING__", t("heading"))
    .replaceAll("__INTRO__", t("intro"))
    .replaceAll("__URL_LABEL__", t("urlLabel"))
    .replaceAll("__URL_PLACEHOLDER__", t("urlPlaceholder"))
    .replaceAll("__SUBMIT__", t("submit"))
    .replaceAll("__LANG_SWITCH_LABEL__", t("langSwitchLabel"))
    .replaceAll("__REPORT_LABEL__", t("reportLabel"))
    .replaceAll("__CTA_TEXT__", t("ctaText"))
    .replaceAll("__CTA_LINK__", t("ctaLink"))
    .replaceAll("__DISCLAIMER__", escapeHtml(dictionary(lang).disclaimer))
    .replaceAll("__PRESSED_PL__", pressed("pl"))
    .replaceAll("__PRESSED_EN__", pressed("en"))
    .replace(/\{\{(\w+)\}\}/g, (_m, key: string) => t(key as UiKey))
    .replace("__TEXTS__", () => safeJson(texts));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** JSON that is safe inside a <script> element. */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

const PAGE = `<!doctype html>
<html lang="__LANG__">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>__META_TITLE__</title>
<meta name="description" content="__META_DESCRIPTION__">
<style nonce="__NONCE__">
:root{--bg:#14110f;--text:#f2ebdd;--muted:#a99f90;--line:#2f2823;--line2:#4a4038;--accent:#ef4444;--ok:#7fb069;--warn:#e0a458}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:clamp(1.6rem,5vw,2.2rem);line-height:1.2;margin:0 0 8px}
h2{font-size:1.2rem;margin:32px 0 12px}
p{margin:0 0 12px}
.muted{color:var(--muted)}
form{display:flex;gap:8px;flex-wrap:wrap;margin:24px 0 8px}
label{flex-basis:100%;font-weight:600}
input{flex:1 1 240px;min-height:48px;padding:0 14px;border-radius:8px;border:1px solid var(--line2);background:#1c1815;color:var(--text);font:inherit}
button{min-height:48px;padding:0 24px;border:0;border-radius:8px;background:var(--accent);color:#14110f;font:inherit;font-weight:700;cursor:pointer}
button:disabled{opacity:.6;cursor:wait}
:focus-visible{outline:3px solid var(--text);outline-offset:2px}
.result{position:relative;margin-top:16px}
.sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.error{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--accent);border-radius:8px;padding:16px}
.error .icon{flex:none;width:28px;height:28px;border-radius:50%;background:var(--accent);color:#14110f;font-weight:800;display:flex;align-items:center;justify-content:center}
.error .body{flex:1 1 auto;min-width:0}
.error p{margin:0 0 4px}
.error .msg{font-weight:700}
.error button{margin-top:12px;min-height:44px}
.loading{position:absolute;inset:0;z-index:2;pointer-events:none}
.load-text{position:sticky;top:12px;display:flex;align-items:center;gap:10px;margin:0 8px;padding:12px 16px 16px;border:1px solid var(--line2);border-radius:8px;background:#1c1815}
.load-text .bar{position:absolute;left:8px;right:8px;bottom:5px;height:3px;border-radius:2px;background:var(--line);overflow:hidden}
.load-text .bar i{display:block;height:100%;width:35%;border-radius:2px;background:var(--accent);opacity:.7}
.spin{flex:none;width:1em;height:1em;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;display:inline-block}
.sk{border-radius:6px;background:var(--line)}
.skeleton p{margin:0 0 12px}
.skeleton .sk-text{width:min(60%,22rem);color:transparent;border-radius:6px;background:var(--line)}
.skeleton .sk-score{display:inline-block;color:transparent;border-radius:8px;background:var(--line)}
.skeleton .sk-note{display:block;width:min(55%,18rem);height:1em;border-radius:6px;background:var(--line)}
.skeleton .cats li{border-color:var(--line)}
.skeleton .cats b,.skeleton .cats span.muted{color:transparent;border-radius:6px;background:var(--line)}
.skeleton .cats b{width:40%}
.skeleton .cats span.muted{width:80%;margin-top:4px}
.skeleton h2{color:transparent;width:min(45%,14rem);border-radius:6px;background:var(--line)}
.skeleton .finding{min-height:96px}
.report{scroll-margin-top:16px}
.report.refreshing{opacity:.45;transition:opacity .2s}
button .spin{margin-right:8px;vertical-align:-2px}
button .spin[hidden]{display:none}
.score{display:flex;align-items:center;gap:12px;margin:24px 0 8px}
.score span{font-size:.9rem;line-height:1.35}
.score strong{font-size:3.5rem;line-height:1;color:var(--accent);font-variant-numeric:tabular-nums}
.cats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;padding:0;list-style:none;margin:16px 0}
.cats li{position:relative;border:1px solid var(--line);border-radius:8px;padding:12px 12px 22px;min-height:140px}
.cats b{display:block;font-size:1.6rem}
.cats span.muted{display:block;font-size:.9rem;line-height:1.35}
.meter{position:absolute;left:12px;right:12px;bottom:10px;height:6px;border-radius:3px;background:var(--line);overflow:hidden}
.meter i{display:block;height:100%;width:calc(var(--v,0) * 1%);border-radius:3px;background:var(--accent)}
.lv-good{border-color:var(--ok)!important}.lv-good .meter i{background:var(--ok)}
.lv-mid{border-color:var(--warn)!important}.lv-mid .meter i{background:var(--warn)}
.lv-low{border-color:var(--accent)!important}
.score strong.lv-good{color:var(--ok)}.score strong.lv-mid{color:var(--warn)}
.finding{border:1px solid var(--line);border-left:4px solid var(--line2);border-radius:8px;padding:12px 16px;margin:0 0 12px}
.finding.high{border-left-color:var(--accent)}
.finding.medium{border-left-color:var(--warn)}
.finding h3{margin:0 0 4px;font-size:1.05rem}
.badge{display:inline-block;font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-right:8px;color:var(--muted)}
.finding.high .badge{color:var(--accent)}
.finding.medium .badge{color:var(--warn)}
ul.plain{padding-left:20px}
.passed li{color:var(--muted)}
.top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.top h1{flex:1 1 auto}
.lang{display:flex;gap:4px;flex:none}
.lang button{min-width:44px;min-height:44px;padding:0 12px;border:1px solid var(--line2);background:transparent;color:var(--text);font-weight:600}
.lang button[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#14110f}
.cta{margin-top:24px}
.cta a{color:var(--text);text-underline-offset:3px;display:inline-block;padding:10px 0}
.note{border:1px solid var(--line);border-radius:8px;padding:12px 16px;background:#1a1613}
[hidden]{display:none}
.report .rv{opacity:1}
@media (prefers-reduced-motion:no-preference){
@keyframes rise{from{opacity:0;transform:translateY(8px)}}
@keyframes fill{from{width:0}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes slide{from{transform:translateX(-100%)}to{transform:translateX(300%)}}
@keyframes shimmer{from{opacity:.55}to{opacity:1}}
.report .rv{animation:rise .4s ease-out both;animation-delay:calc(var(--i,0) * 45ms)}
.meter i{animation:fill .9s ease-out both;animation-delay:calc(var(--i,0) * 45ms + 150ms)}
.spin{animation:spin .8s linear infinite}
.load-text .bar i{animation:slide 1.4s ease-in-out infinite}
.skeleton .sk-text,.skeleton .sk-score,.skeleton .sk-note,.skeleton .cats li,.skeleton .cats b,.skeleton .cats span.muted,.skeleton h2,.skeleton .finding{animation:shimmer 1s ease-in-out infinite alternate}
.error{animation:rise .25s ease-out}
}
@media (prefers-reduced-motion:reduce){.load-text .bar i{width:100%;opacity:.35}}
</style>
</head>
<body>
<main>
  <header class="top">
    <h1 data-i18n="heading">__HEADING__</h1>
    <div class="lang" role="group" aria-label="__LANG_SWITCH_LABEL__" data-i18n-aria-label="langSwitchLabel">
      <button type="button" data-lang="pl" lang="pl" aria-label="Polski" aria-pressed="__PRESSED_PL__">PL</button>
      <button type="button" data-lang="en" lang="en" aria-label="English" aria-pressed="__PRESSED_EN__">EN</button>
    </div>
  </header>
  <p class="muted" data-i18n="intro">__INTRO__</p>
  <form id="form">
    <label for="url" data-i18n="urlLabel">__URL_LABEL__</label>
    <input id="url" name="url" type="text" inputmode="url" autocomplete="url" placeholder="__URL_PLACEHOLDER__" data-i18n-placeholder="urlPlaceholder" required maxlength="2048">
    <button id="go" type="submit"><span class="spin" aria-hidden="true" hidden></span><span id="goText" data-i18n="submit">__SUBMIT__</span></button>
  </form>
  <div id="result" class="result" aria-busy="false">
    <div id="live" class="sr-only" role="status" aria-live="polite"></div>
    <div id="skeleton" class="skeleton" aria-hidden="true" hidden>
      <p class="sk-text">&nbsp;</p>
      <div class="score"><strong class="sk-score">00</strong><span class="sk-note"></span></div>
      <ul class="cats">
        <li><b>&nbsp;</b><span class="muted">&nbsp;</span><span class="meter"></span></li>
        <li><b>&nbsp;</b><span class="muted">&nbsp;</span><span class="meter"></span></li>
        <li><b>&nbsp;</b><span class="muted">&nbsp;</span><span class="meter"></span></li>
        <li><b>&nbsp;</b><span class="muted">&nbsp;</span><span class="meter"></span></li>
      </ul>
      <h2>&nbsp;</h2>
      <div class="finding"></div>
      <div class="finding"></div>
      <div class="finding"></div>
    </div>
    <div id="loading" class="loading" hidden>
      <p class="load-text muted"><span class="spin" aria-hidden="true"></span><span id="loadText" data-i18n="loadingText">{{loadingText}}</span><span class="bar" aria-hidden="true"><i></i></span></p>
    </div>
    <div id="error" class="error" hidden>
      <span class="icon" aria-hidden="true">!</span>
      <div class="body">
        <p class="msg" id="errorMsg"></p>
        <p class="muted" id="errorHint"></p>
        <button type="button" id="retry" data-i18n="retry">{{retry}}</button>
      </div>
    </div>
    <section id="report" class="report" hidden aria-label="__REPORT_LABEL__" data-i18n-aria-label="reportLabel"></section>
  </div>
  <p class="cta"><span data-i18n="ctaText">__CTA_TEXT__</span> <a href="https://piotrmajkutewicz.pl" rel="noopener" data-i18n="ctaLink">__CTA_LINK__</a></p>
  <p class="note muted" id="disclaimer" data-i18n="disclaimer">__DISCLAIMER__</p>
</main>
<script nonce="__NONCE__">
(function () {
  var TEXTS = __TEXTS__;
  var SERVER_LANG = "__LANG__";
  // Real timings, not a fake progress: the slow notice appears after SLOW_MS of waiting and the
  // request is given up after TIMEOUT_MS (the server stops on its own after about 15 seconds).
  var SLOW_MS = 8000;
  var TIMEOUT_MS = 20000;
  var form = document.getElementById("form");
  var input = document.getElementById("url");
  var go = document.getElementById("go");
  var goText = document.getElementById("goText");
  var goSpin = go.querySelector(".spin");
  var resultEl = document.getElementById("result");
  var live = document.getElementById("live");
  var skeletonEl = document.getElementById("skeleton");
  var loadingEl = document.getElementById("loading");
  var loadText = document.getElementById("loadText");
  var errorEl = document.getElementById("error");
  var errorMsg = document.getElementById("errorMsg");
  var errorHint = document.getElementById("errorHint");
  var retryBtn = document.getElementById("retry");
  var reportEl = document.getElementById("report");
  var lang = SERVER_LANG;
  var lastUrl = null;
  var runId = 0;
  var busy = false;
  var userScrolled = false;
  var slowTimer = null;
  var timeoutTimer = null;
  var flip = false;

  function valid(v) { return v === "pl" || v === "en"; }
  function readStored() { try { return window.localStorage.getItem("lang"); } catch (e) { return null; } }
  function writeStored(v) { try { window.localStorage.setItem("lang", v); } catch (e) { /* the page works without storage */ } }
  function reduced() { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
  function T(key, params) {
    var s = TEXTS[lang][key] || "";
    if (params) for (var k in params) s = s.split("{" + k + "}").join(String(params[k]));
    return s;
  }
  function setText(node, key) { node.setAttribute("data-i18n", key); node.textContent = T(key); }
  // The live region tells screen reader users what is happening. A trailing no-break space makes
  // a repeated message count as a change.
  function announce(msg) { flip = !flip; live.textContent = msg + (flip ? "\u00a0" : ""); }

  // el("tag", {class: "x"}, "text" | [children]) builds nodes with textContent only.
  function el(tag, attrs, content) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (typeof content === "string") n.textContent = content;
    else if (content) content.forEach(function (c) { n.appendChild(c); });
    return n;
  }
  var SEVERITY = { high: "severityHigh", medium: "severityMedium", low: "severityLow" };
  function level(score) { return score >= 80 ? "lv-good" : score >= 50 ? "lv-mid" : "lv-low"; }

  // Counts a number up from 0. Without motion the final value is set at once.
  function countUp(node, to) {
    if (reduced()) { node.textContent = String(to); return; }
    var start = null;
    node.textContent = "0";
    function step(ts) {
      if (start === null) start = ts;
      var k = Math.min(1, (ts - start) / 900);
      node.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) window.requestAnimationFrame(step);
    }
    window.requestAnimationFrame(step);
  }

  function render(r) {
    var n = 0; // position in the entrance cascade, capped so long reports do not wait
    function rv(node) { node.classList.add("rv"); node.style.setProperty("--i", String(Math.min(n++, 14))); return node; }
    reportEl.replaceChildren();
    reportEl.appendChild(rv(el("p", { class: "muted" }, T("reportFor", { url: r.url }))));
    var scoreNum = el("strong", { class: level(r.score) }, String(r.score));
    reportEl.appendChild(rv(el("div", { class: "score" }, [scoreNum, el("span", null, T("scoreOutOf"))])));
    countUp(scoreNum, r.score);
    reportEl.appendChild(el("ul", { class: "cats" }, r.categories.map(function (c) {
      var bar = el("i");
      var li = rv(el("li", { class: level(c.score) }, [
        el("b", null, String(c.score)),
        el("span", { class: "muted" }, c.name),
        el("span", { class: "meter" }, [bar])
      ]));
      bar.style.setProperty("--v", String(c.score));
      bar.style.setProperty("--i", li.style.getPropertyValue("--i"));
      return li;
    })));

    reportEl.appendChild(rv(el("h2", null, T("thingsToFix", { count: r.findings.length }))));
    if (r.findings.length === 0) reportEl.appendChild(rv(el("p", null, T("noProblems"))));
    r.findings.forEach(function (f) {
      var title = f.title + (f.detail ? " (" + f.detail + ")" : "");
      reportEl.appendChild(rv(el("article", { class: "finding " + f.severity }, [
        el("h3", null, [el("span", { class: "badge" }, T(SEVERITY[f.severity]) || f.severity), document.createTextNode(title)]),
        el("p", null, [el("strong", null, T("why")), document.createTextNode(f.why)]),
        el("p", null, [el("strong", null, T("fix")), document.createTextNode(f.fix)])
      ])));
    });

    reportEl.appendChild(el("h2", null, T("passedHeading", { count: r.passed.length })));
    reportEl.appendChild(el("ul", { class: "plain passed" }, r.passed.map(function (p) { return el("li", null, p.title); })));

    reportEl.appendChild(el("h2", null, T("notCheckedHeading")));
    reportEl.appendChild(el("ul", { class: "plain" }, r.notChecked.map(function (t) { return el("li", null, t); })));
  }

  function setBusy(on) {
    busy = on;
    go.disabled = on;
    input.readOnly = on;
    goSpin.hidden = !on;
    setText(goText, on ? "submitBusy" : "submit");
    resultEl.setAttribute("aria-busy", String(on));
  }

  function clearTimers() {
    window.clearTimeout(slowTimer);
    window.clearTimeout(timeoutTimer);
  }

  function finish() {
    clearTimers();
    loadingEl.hidden = true;
    skeletonEl.hidden = true;
    reportEl.classList.remove("refreshing");
    setBusy(false);
  }

  // Error kinds: "network", "timeout" or a response from the API (code and message).
  function showError(kind, data) {
    var code = data && data.error && data.error.code;
    var message, hint, retry = true;
    if (kind === "network") { message = T("errorNetwork"); hint = "errorHintNetwork"; }
    else if (kind === "timeout") { message = T("errorTimeout"); hint = "errorHintSlow"; }
    else {
      message = (data && data.error && data.error.message) || T("errorGeneric");
      if (code === "rate_limited") hint = "errorHintRate";
      else if (code === "timeout" || code === "unreachable" || code === "too_many_redirects" || code === "bad_response") hint = "errorHintSlow";
      else if (code === "blocked_target" || code === "invalid_url" || code === "invalid_json" || code === "invalid_lang" || code === "body_too_large" || code === "invalid_body") { hint = "errorHintBlocked"; retry = false; }
      else hint = "errorHintGeneric";
    }
    reportEl.hidden = true;
    errorMsg.textContent = message;
    setText(errorHint, hint);
    retryBtn.hidden = !retry;
    errorEl.hidden = false;
    announce(message + " " + T(hint));
  }

  // Scrolls only when the report starts below the visible area and the person has not scrolled meanwhile.
  function revealIfNeeded() {
    if (userScrolled) return;
    if (reportEl.getBoundingClientRect().top > window.innerHeight - 120) {
      reportEl.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });
    }
  }

  function run(url, refresh) {
    var id = ++runId;
    // For a language switch: where the first heading of the old report is on screen. Text above
    // the report can change height with the language, so the position of the content is kept, not scrollY.
    var anchor = refresh ? reportEl.querySelector("h2") : null;
    var anchorTop = anchor ? resultEl.getBoundingClientRect().top + anchor.offsetTop : 0;
    var timedOut = false;
    lastUrl = url;
    clearTimers();
    errorEl.hidden = true;
    userScrolled = false;
    if (refresh && !reportEl.hidden) {
      // Language switch: keep the old report in place, dimmed, with the loading note over it.
      reportEl.classList.add("refreshing");
      skeletonEl.hidden = true;
    } else {
      refresh = false;
      reportEl.hidden = true;
      reportEl.classList.remove("refreshing");
      skeletonEl.hidden = false;
    }
    setText(loadText, "loadingText");
    loadingEl.hidden = false;
    setBusy(true);
    announce(T("announceLoading"));

    slowTimer = window.setTimeout(function () {
      if (id !== runId) return;
      setText(loadText, "loadingSlow");
      announce(T("loadingSlow"));
    }, SLOW_MS);
    var ctrl = new AbortController();
    timeoutTimer = window.setTimeout(function () { timedOut = true; ctrl.abort(); }, TIMEOUT_MS);

    fetch("/api/audit?lang=" + lang, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: url, lang: lang }),
      signal: ctrl.signal
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (r) {
      if (id !== runId) return;
      finish();
      if (timedOut) { showError("timeout"); return; }
      if (r.ok && r.data) {
        render(r.data);
        reportEl.hidden = false;
        announce(T("announceDone", { score: r.data.score }));
        var heading = refresh ? reportEl.querySelector("h2") : null;
        if (heading) {
          var delta = resultEl.getBoundingClientRect().top + heading.offsetTop - anchorTop;
          if (Math.abs(delta) > 1) window.scrollBy(0, delta);
        } else revealIfNeeded();
      } else showError("response", r.data);
    }).catch(function () {
      if (id !== runId) return;
      finish();
      showError(timedOut ? "timeout" : "network");
    });
  }

  // Sets the language of every static text. Report texts come from the API in the same language.
  function apply(l) {
    lang = l;
    document.documentElement.lang = l;
    document.title = T("metaTitle");
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", T("metaDescription"));
    document.querySelectorAll("[data-i18n]").forEach(function (n) { n.textContent = T(n.getAttribute("data-i18n")); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (n) { n.setAttribute("placeholder", T(n.getAttribute("data-i18n-placeholder"))); });
    document.querySelectorAll("[data-i18n-aria-label]").forEach(function (n) { n.setAttribute("aria-label", T(n.getAttribute("data-i18n-aria-label"))); });
    document.querySelectorAll("[data-lang]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-lang") === l)); });
  }

  function choose(l) {
    if (l === lang) return;
    writeStored(l);
    try {
      var u = new URL(window.location.href);
      u.searchParams.set("lang", l);
      window.history.replaceState(null, "", u.toString());
    } catch (e) { /* ignore */ }
    apply(l);
    // Report and error texts come from the API, so a visible report, error or running request is repeated.
    if (lastUrl && (!reportEl.hidden || !errorEl.hidden || busy)) run(lastUrl, !reportEl.hidden);
  }

  document.querySelectorAll("[data-lang]").forEach(function (b) {
    b.addEventListener("click", function () { choose(b.getAttribute("data-lang")); });
  });
  retryBtn.addEventListener("click", function () { if (lastUrl && !busy) run(lastUrl, false); });
  ["wheel", "touchmove", "keydown"].forEach(function (ev) {
    window.addEventListener(ev, function () { if (busy) userScrolled = true; }, { passive: true });
  });

  // Order of precedence: ?lang= in the address, then the saved choice, then Polish.
  var fromQuery = new URLSearchParams(window.location.search).get("lang");
  var initial = "pl";
  if (valid(fromQuery)) { initial = fromQuery; writeStored(fromQuery); }
  else if (valid(readStored())) initial = readStored();
  if (initial !== SERVER_LANG) apply(initial);
  else lang = initial;

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy) return;
    run(input.value, false);
  });
})();
</script>
</body>
</html>`;
