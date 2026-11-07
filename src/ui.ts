import { DEFAULT_LANG, dictionary, LANGS, type Lang, type UiKey } from "./i18n";
import { DEBUG_SCROLL_JS } from "./debug-scroll.js";

/** The whole UI is one static page. Report data is only ever inserted with textContent. */
export function renderUi(nonce: string, lang: Lang = DEFAULT_LANG): string {
  const ui = dictionary(lang).ui;
  const t = (key: UiKey) => escapeHtml(ui[key]);
  // Both languages are embedded, so the switch works without another request for the page.
  const texts = Object.fromEntries(
    LANGS.map((l) => {
      const d = dictionary(l);
      return [
        l,
        {
          ui: { ...d.ui, disclaimer: d.disclaimer },
          findings: d.findings,
          passed: d.passed,
          basis: d.basis,
          facts: d.facts,
          categories: d.categories,
          errors: d.errors,
          notChecked: d.notChecked,
        },
      ];
    }),
  );
  const pressed = (l: Lang) => (l === lang ? "true" : "false");

  return PAGE.replace("__DEBUG_JS__", () => DEBUG_SCROLL_JS)
    .replaceAll("__NONCE__", nonce)
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
<meta name="theme-color" content="#14110f">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex, nofollow">
<title>__META_TITLE__</title>
<meta name="description" content="__META_DESCRIPTION__">
<style nonce="__NONCE__">
html{background:#14110f;color-scheme:dark}
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
.tops{list-style:none;margin:0 0 8px;padding:0;display:grid;gap:12px;counter-reset:t}
.tops li{counter-increment:t;position:relative;border:1px solid var(--line2);border-left:4px solid var(--line2);border-radius:8px;padding:12px 16px 12px 56px}
.tops li.high{border-left-color:var(--accent)}.tops li.medium{border-left-color:var(--warn)}
.tops li::before{content:counter(t);position:absolute;left:14px;top:12px;width:28px;height:28px;border-radius:50%;background:var(--text);color:#14110f;font-weight:800;display:flex;align-items:center;justify-content:center}
.tops h3{margin:0 0 4px;font-size:1.05rem}
.tops p{margin:0}
.basis{font-size:.85rem;color:var(--muted);margin:0}
.finding p.basis{margin-top:6px}
details.scoring{border:1px solid var(--line);border-radius:8px;padding:0 16px 4px;margin:16px 0}
details.scoring summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:600}
.psi{border:1px solid var(--line);border-radius:8px;padding:4px 16px 12px;margin-top:24px}
.psi h2{margin:12px 0}
.psi .row{padding:8px 0;border-top:1px solid var(--line)}
.psi .row p{margin:0}
.psi-value{font-weight:700;font-variant-numeric:tabular-nums}
.chip{display:inline-block;font-size:.8rem;font-weight:700;padding:1px 8px;border-radius:10px;border:1px solid currentColor}
.chip.good{color:var(--ok)}.chip.needs{color:var(--warn)}.chip.poor{color:var(--accent)}
.psi .load-text{position:relative;top:auto;margin:0 0 12px;padding:8px 0 14px;border:0;background:transparent}
.psi .load-text .bar{left:0;right:0;bottom:2px}
.report.still .rv,.report.still .meter i{animation:none}
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
<script nonce="__NONCE__">__DEBUG_JS__</script>
<script nonce="__NONCE__">
(function () {
  var TEXTS = __TEXTS__;
  var SERVER_LANG = "__LANG__";
  // Real timings, not a fake progress: the slow notice appears after SLOW_MS of waiting and the
  // request is given up after TIMEOUT_MS (the server stops on its own after about 15 seconds).
  var SLOW_MS = 8000;
  var TIMEOUT_MS = 20000;
  // The optional PageSpeed measurement is allowed to take longer (the server waits up to 45 seconds).
  var PSI_TIMEOUT_MS = 50000;
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
  var lastReport = null; // the language-neutral report of the last audit
  var lastError = null; // { kind, code, key, message } of the last error
  var psi = { state: "idle", data: null, key: null, url: null };
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
  function D() { return TEXTS[lang]; }
  function fmt(tpl, params) {
    return String(tpl || "").replace(/\\{(\\w+)\\}/g, function (m, k) { return params && Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m; });
  }
  function T(key, params) { return fmt(D().ui[key], params); }
  function setText(node, key) { node.setAttribute("data-i18n", key); node.textContent = T(key); }
  // The live region tells screen reader users what is happening. A trailing no-break space makes
  // a repeated message count as a change.
  function announce(msg) { flip = !flip; live.textContent = msg + (flip ? " " : ""); }
  function num(n, digits) { return n.toLocaleString(lang === "pl" ? "pl-PL" : "en-GB", { maximumFractionDigits: digits }); }

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
  function countUp(node, to, animate) {
    if (!animate || reduced()) { node.textContent = String(to); return; }
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

  // Texts of a finding in the current language, built from the neutral report and the dictionary.
  function findingText(f) {
    var t = D().findings[f.key] || {};
    return {
      title: fmt(t.title, f.params),
      detail: t.detail ? fmt(t.detail, f.params) : "",
      why: fmt(t.why, f.params),
      fix: fmt(t.fix, f.params),
      impact: fmt(t.impact, f.params),
      basis: fmt(D().basis[f.basis], f.params)
    };
  }

  function render(n, animate) {
    var i = 0; // position in the entrance cascade, capped so long reports do not wait
    function rv(node) {
      if (animate) { node.classList.add("rv"); node.style.setProperty("--i", String(Math.min(i++, 14))); }
      return node;
    }
    reportEl.classList.toggle("still", !animate);
    reportEl.replaceChildren();
    reportEl.appendChild(rv(el("p", { class: "muted" }, T("reportFor", { url: n.url }))));
    var scoreNum = el("strong", { class: level(n.score) }, String(n.score));
    reportEl.appendChild(rv(el("div", { class: "score" }, [scoreNum, el("span", null, T("scoreOutOf"))])));
    countUp(scoreNum, n.score, animate);
    reportEl.appendChild(el("ul", { class: "cats" }, n.categories.map(function (c) {
      var bar = el("i");
      var li = rv(el("li", { class: level(c.score) }, [
        el("b", null, String(c.score)),
        el("span", { class: "muted" }, D().categories[c.id] || c.id),
        el("span", { class: "meter" }, [bar])
      ]));
      bar.style.setProperty("--v", String(c.score));
      bar.style.setProperty("--i", li.style.getPropertyValue("--i") || "0");
      return li;
    })));

    // The most important things first, with one sentence about what they mean for the business.
    if (n.top.length > 0) {
      reportEl.appendChild(rv(el("h2", null, T("topHeading"))));
      reportEl.appendChild(el("ol", { class: "tops" }, n.top.map(function (idx) {
        var f = n.findings[idx];
        var x = findingText(f);
        return rv(el("li", { class: f.severity }, [
          el("h3", null, x.title),
          el("p", null, [el("strong", null, T("impactLabel")), document.createTextNode(x.impact)])
        ]));
      })));
    }

    reportEl.appendChild(rv(el("h2", null, T("thingsToFix", { count: n.findings.length }))));
    if (n.findings.length === 0) reportEl.appendChild(rv(el("p", null, T("noProblems"))));
    n.findings.forEach(function (f) {
      var x = findingText(f);
      var title = x.title + (x.detail ? " (" + x.detail + ")" : "");
      reportEl.appendChild(rv(el("article", { class: "finding " + f.severity }, [
        el("h3", null, [el("span", { class: "badge" }, T(SEVERITY[f.severity]) || f.severity), document.createTextNode(title)]),
        el("p", null, [el("strong", null, T("why")), document.createTextNode(x.why)]),
        el("p", null, [el("strong", null, T("fix")), document.createTextNode(x.fix)]),
        el("p", { class: "basis" }, [el("strong", null, T("basisLabel")), document.createTextNode(x.basis)])
      ])));
    });

    reportEl.appendChild(el("h2", null, T("passedHeading", { count: n.passed.length })));
    reportEl.appendChild(el("ul", { class: "plain passed" }, n.passed.map(function (p) { return el("li", null, D().passed[p.id] || p.id); })));

    if (n.pagespeedAvailable) reportEl.appendChild(el("section", { class: "psi", id: "psi" }));

    if (n.facts.length > 0) {
      reportEl.appendChild(el("h2", null, T("factsHeading")));
      reportEl.appendChild(el("ul", { class: "plain" }, n.facts.map(function (f) { return el("li", null, fmt(D().facts[f.id], f.params)); })));
    }

    // Scope of the check, so it is clear that this is one page plus a small sample.
    var cov = n.coverage;
    reportEl.appendChild(el("h2", null, T("coverageHeading")));
    reportEl.appendChild(el("p", null, T("coverageSummary", { checks: cov.checks, requests: cov.requests, hosts: cov.hosts.join(", ") })));
    if (cov.links || cov.resources) {
      reportEl.appendChild(el("p", null, T("coverageSample", {
        linksChecked: cov.links ? cov.links.checked : 0, linksTotal: cov.links ? cov.links.total : 0,
        resourcesChecked: cov.resources ? cov.resources.checked : 0, resourcesTotal: cov.resources ? cov.resources.total : 0
      })));
    } else reportEl.appendChild(el("p", null, T("coverageNoSample")));

    var weights = Object.keys(n.scoring.weights).map(function (id) { return (D().categories[id] || id) + " " + n.scoring.weights[id] + "%"; }).join(", ");
    reportEl.appendChild(el("details", { class: "scoring" }, [
      el("summary", null, T("scoringSummary")),
      el("p", null, T("scoringIntro")),
      el("p", null, T("scoringWeights", { weights: weights })),
      el("p", null, T("scoringPenalty", n.scoring.penalty))
    ]));

    reportEl.appendChild(el("h2", null, T("notCheckedHeading")));
    reportEl.appendChild(el("ul", { class: "plain" }, D().notChecked.map(function (t) { return el("li", null, t); })));
    renderPsi();
  }

  // ---- Optional PageSpeed Insights measurement (second stage) ----
  var RATING = { lcp: [2500, 4000], cls: [0.1, 0.25], tbt: [200, 600], fcp: [1800, 3000], inp: [200, 500] };
  function rate(kind, v) {
    if (kind === "score") return v >= 90 ? "good" : v >= 50 ? "needs" : "poor";
    var t = RATING[kind];
    return v <= t[0] ? "good" : v <= t[1] ? "needs" : "poor";
  }
  var RATING_KEY = { good: "psiGood", needs: "psiNeeds", poor: "psiPoor" };

  function renderPsi() {
    var box = document.getElementById("psi");
    if (!box) return;
    box.replaceChildren();
    box.appendChild(el("h2", null, T("psiHeading")));
    if (psi.state === "loading") {
      box.appendChild(el("p", { class: "load-text muted" }, [
        el("span", { class: "spin", "aria-hidden": "true" }),
        el("span", null, T("psiLoading")),
        el("span", { class: "bar", "aria-hidden": "true" }, [el("i")])
      ]));
      return;
    }
    if (psi.state === "error") {
      box.appendChild(el("p", { class: "muted" }, T("psiError", { reason: D().errors[psi.key] || D().errors.pagespeed_unavailable })));
      return;
    }
    if (psi.state !== "done") return;
    var r = psi.data;
    var rows = [];
    if (r.score !== null) rows.push(["psiScore", r.score + " / 100", rate("score", r.score), "psiScoreHelp"]);
    if (r.lcpMs !== null) rows.push(["psiLcp", num(r.lcpMs / 1000, 1) + " s", rate("lcp", r.lcpMs), "psiLcpHelp"]);
    if (r.cls !== null) rows.push(["psiCls", num(r.cls, 2), rate("cls", r.cls), "psiClsHelp"]);
    if (r.tbtMs !== null) rows.push(["psiTbt", num(Math.round(r.tbtMs), 0) + " ms", rate("tbt", r.tbtMs), "psiTbtHelp"]);
    if (r.fcpMs !== null) rows.push(["psiFcp", num(r.fcpMs / 1000, 1) + " s", rate("fcp", r.fcpMs), "psiFcpHelp"]);
    if (r.inpMs !== null) rows.push(["psiInp", num(Math.round(r.inpMs), 0) + " ms", rate("inp", r.inpMs), "psiInpHelp"]);
    box.appendChild(el("p", { class: "muted" }, T("psiSource")));
    rows.forEach(function (row) {
      box.appendChild(el("div", { class: "row" }, [
        el("p", { class: "psi-line" }, [
          el("strong", null, T(row[0])),
          document.createTextNode(" "),
          el("span", { class: "psi-value" }, row[1]),
          document.createTextNode(" "),
          el("span", { class: "chip " + row[2] }, T(RATING_KEY[row[2]]))
        ]),
        el("p", { class: "basis" }, T(row[3]))
      ]));
    });
  }

  function loadPsi(url, id) {
    if (psi.url === url && psi.state !== "idle") { renderPsi(); return; }
    psi = { state: "loading", data: null, key: null, url: url };
    renderPsi();
    var ctrl = new AbortController();
    var t = window.setTimeout(function () { ctrl.abort(); }, PSI_TIMEOUT_MS);
    fetch("/api/pagespeed?lang=" + lang, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: url }),
      signal: ctrl.signal
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (r) {
      window.clearTimeout(t);
      if (id !== runId) return;
      if (r.ok && r.data && r.data.pagespeed) {
        psi.state = "done";
        psi.data = r.data.pagespeed;
        announce(T("psiHeading") + ": " + T("psiScore") + " " + (psi.data.score === null ? "" : psi.data.score + "/100"));
      } else {
        psi.state = "error";
        psi.key = (r.data && r.data.error && r.data.error.key) || "pagespeed_unavailable";
      }
      renderPsi();
    }).catch(function () {
      window.clearTimeout(t);
      if (id !== runId) return;
      psi.state = "error";
      psi.key = "pagespeed_timeout";
      renderPsi();
    });
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

  var CODE_HINT = {
    rate_limited: "errorHintRate",
    timeout: "errorHintSlow", unreachable: "errorHintSlow", too_many_redirects: "errorHintSlow", bad_response: "errorHintSlow",
    bad_certificate: "errorHintCertificate"
  };
  var NO_RETRY = { blocked_target: 1, invalid_url: 1, invalid_json: 1, invalid_lang: 1, body_too_large: 1, invalid_body: 1 };

  // Shows an error. e = { kind: "network" | "timeout" | "response", code, key, message }.
  function showError(e, announceIt) {
    lastError = e;
    var message, hint, retry = true;
    if (e.kind === "network") { message = T("errorNetwork"); hint = "errorHintNetwork"; }
    else if (e.kind === "timeout") { message = T("errorTimeout"); hint = "errorHintSlow"; }
    else {
      message = (e.key && D().errors[e.key]) || e.message || T("errorGeneric");
      hint = NO_RETRY[e.code] ? "errorHintBlocked" : (CODE_HINT[e.code] || "errorHintGeneric");
      if (NO_RETRY[e.code]) retry = false;
    }
    reportEl.hidden = true;
    errorMsg.textContent = message;
    setText(errorHint, hint);
    retryBtn.hidden = !retry;
    errorEl.hidden = false;
    if (announceIt) announce(message + " " + T(hint));
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
    var timedOut = false;
    lastUrl = url;
    clearTimers();
    errorEl.hidden = true;
    userScrolled = false;
    if (refresh && !reportEl.hidden) {
      // Kept for a repeated audit of the same address: the old report stays, dimmed, under the note.
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
      if (timedOut) { showError({ kind: "timeout" }, true); return; }
      if (r.ok && r.data && r.data.neutral) {
        lastReport = r.data.neutral;
        lastError = null;
        psi = { state: "idle", data: null, key: null, url: null };
        render(lastReport, true);
        reportEl.hidden = false;
        announce(T("announceDone", { score: lastReport.score }));
        revealIfNeeded();
        if (lastReport.pagespeedAvailable) loadPsi(lastReport.url, id);
      } else {
        var err = (r.data && r.data.error) || {};
        showError({ kind: "response", code: err.code, key: err.key, message: err.message }, true);
      }
    }).catch(function () {
      if (id !== runId) return;
      finish();
      showError({ kind: timedOut ? "timeout" : "network" }, true);
    });
  }

  // Sets the language of every static text.
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

  // Changing the language never repeats the audit: the report is drawn again from the neutral data.
  function choose(l) {
    if (l === lang) return;
    writeStored(l);
    try {
      var u = new URL(window.location.href);
      u.searchParams.set("lang", l);
      window.history.replaceState(null, "", u.toString());
    } catch (e) { /* ignore */ }
    // Where the first heading of the report is on screen, so the content can be kept in place.
    var anchor = !reportEl.hidden ? reportEl.querySelector("h2") : null;
    var anchorTop = anchor ? resultEl.getBoundingClientRect().top + anchor.offsetTop : 0;
    apply(l);
    if (!reportEl.hidden && lastReport) {
      render(lastReport, false);
      var heading = reportEl.querySelector("h2");
      if (heading) {
        var delta = resultEl.getBoundingClientRect().top + heading.offsetTop - anchorTop;
        if (Math.abs(delta) > 1) window.scrollBy(0, delta);
      }
    } else if (!errorEl.hidden && lastError) showError(lastError, false);
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
