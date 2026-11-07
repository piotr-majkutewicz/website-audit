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
.error{border:1px solid var(--accent);border-radius:8px;padding:12px 16px;margin-top:16px}
.score{display:flex;align-items:baseline;gap:12px;margin:24px 0 8px}
.score strong{font-size:3.5rem;line-height:1;color:var(--accent)}
.cats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;padding:0;list-style:none;margin:16px 0}
.cats li{border:1px solid var(--line);border-radius:8px;padding:12px}
.cats b{display:block;font-size:1.6rem}
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
@media (prefers-reduced-motion:no-preference){.report{animation:rise .4s ease-out}@keyframes rise{from{opacity:0;transform:translateY(8px)}}}
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
    <button id="go" type="submit" data-i18n="submit">__SUBMIT__</button>
  </form>
  <p class="muted" id="status" role="status" aria-live="polite"></p>
  <div id="error" class="error" role="alert" hidden></div>
  <section id="report" class="report" hidden aria-label="__REPORT_LABEL__" data-i18n-aria-label="reportLabel"></section>
  <p class="cta"><span data-i18n="ctaText">__CTA_TEXT__</span> <a href="https://piotrmajkutewicz.pl" rel="noopener" data-i18n="ctaLink">__CTA_LINK__</a></p>
  <p class="note muted" id="disclaimer" data-i18n="disclaimer">__DISCLAIMER__</p>
</main>
<script nonce="__NONCE__">
(function () {
  var TEXTS = __TEXTS__;
  var SERVER_LANG = "__LANG__";
  var form = document.getElementById("form");
  var input = document.getElementById("url");
  var go = document.getElementById("go");
  var statusEl = document.getElementById("status");
  var errorEl = document.getElementById("error");
  var reportEl = document.getElementById("report");
  var lang = SERVER_LANG;
  var lastUrl = null;
  var runId = 0;

  function valid(v) { return v === "pl" || v === "en"; }
  function readStored() { try { return window.localStorage.getItem("lang"); } catch (e) { return null; } }
  function writeStored(v) { try { window.localStorage.setItem("lang", v); } catch (e) { /* the page works without storage */ } }
  function T(key, params) {
    var s = TEXTS[lang][key] || "";
    if (params) for (var k in params) s = s.split("{" + k + "}").join(String(params[k]));
    return s;
  }

  // el("tag", {class: "x"}, "text" | [children]) builds nodes with textContent only.
  function el(tag, attrs, content) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (typeof content === "string") n.textContent = content;
    else if (content) content.forEach(function (c) { n.appendChild(c); });
    return n;
  }
  var SEVERITY = { high: "severityHigh", medium: "severityMedium", low: "severityLow" };

  function render(r) {
    reportEl.replaceChildren();
    reportEl.appendChild(el("p", { class: "muted" }, T("reportFor", { url: r.url })));
    reportEl.appendChild(el("div", { class: "score" }, [
      el("strong", null, String(r.score)),
      el("span", null, T("scoreOutOf"))
    ]));
    reportEl.appendChild(el("ul", { class: "cats" }, r.categories.map(function (c) {
      return el("li", null, [el("b", null, String(c.score)), el("span", { class: "muted" }, c.name)]);
    })));

    reportEl.appendChild(el("h2", null, T("thingsToFix", { count: r.findings.length })));
    if (r.findings.length === 0) reportEl.appendChild(el("p", null, T("noProblems")));
    r.findings.forEach(function (f) {
      var title = f.title + (f.detail ? " (" + f.detail + ")" : "");
      reportEl.appendChild(el("article", { class: "finding " + f.severity }, [
        el("h3", null, [el("span", { class: "badge" }, T(SEVERITY[f.severity]) || f.severity), document.createTextNode(title)]),
        el("p", null, [el("strong", null, T("why")), document.createTextNode(f.why)]),
        el("p", null, [el("strong", null, T("fix")), document.createTextNode(f.fix)])
      ]));
    });

    reportEl.appendChild(el("h2", null, T("passedHeading", { count: r.passed.length })));
    reportEl.appendChild(el("ul", { class: "plain passed" }, r.passed.map(function (p) { return el("li", null, p.title); })));

    reportEl.appendChild(el("h2", null, T("notCheckedHeading")));
    reportEl.appendChild(el("ul", { class: "plain" }, r.notChecked.map(function (t) { return el("li", null, t); })));
    reportEl.hidden = false;
  }

  function run(url) {
    var id = ++runId;
    lastUrl = url;
    errorEl.hidden = true;
    reportEl.hidden = true;
    go.disabled = true;
    statusEl.textContent = T("loading");
    fetch("/api/audit?lang=" + lang, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: url, lang: lang })
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (r) {
      if (id !== runId) return;
      if (r.ok && r.data) render(r.data);
      else {
        errorEl.textContent = (r.data && r.data.error && r.data.error.message) || T("errorGeneric");
        errorEl.hidden = false;
      }
    }).catch(function () {
      if (id !== runId) return;
      errorEl.textContent = T("errorNetwork");
      errorEl.hidden = false;
    }).then(function () {
      if (id !== runId) return;
      go.disabled = false;
      statusEl.textContent = "";
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
    errorEl.hidden = true;
    // Report and error texts come from the API, so a visible report or a running request is repeated.
    if (lastUrl && (!reportEl.hidden || go.disabled)) run(lastUrl);
  }

  document.querySelectorAll("[data-lang]").forEach(function (b) {
    b.addEventListener("click", function () { choose(b.getAttribute("data-lang")); });
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
    run(input.value);
  });
})();
</script>
</body>
</html>`;
