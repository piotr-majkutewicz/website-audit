/** The whole UI is one static page. Report data is only ever inserted with textContent. */
export function renderUi(nonce: string): string {
  return PAGE.replaceAll("__NONCE__", nonce);
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Website audit for small businesses</title>
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="A quick, unofficial check of one web page: HTTPS, security headers, basic SEO, page weight and basic accessibility.">
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
.cta{margin-top:24px}
.cta a{color:var(--text);text-underline-offset:3px;display:inline-block;padding:10px 0}
.note{border:1px solid var(--line);border-radius:8px;padding:12px 16px;background:#1a1613}
[hidden]{display:none}
@media (prefers-reduced-motion:no-preference){.report{animation:rise .4s ease-out}@keyframes rise{from{opacity:0;transform:translateY(8px)}}}
</style>
</head>
<body>
<main>
  <h1>Website audit for small businesses</h1>
  <p class="muted">Enter an address and get a short report: HTTPS, security headers, basic SEO, page weight and basic accessibility, with plain-language advice on what to fix first.</p>
  <form id="form">
    <label for="url">Website address</label>
    <input id="url" name="url" type="text" inputmode="url" autocomplete="url" placeholder="example.com" required maxlength="2048">
    <button id="go" type="submit">Run audit</button>
  </form>
  <p class="muted" id="status" role="status" aria-live="polite"></p>
  <div id="error" class="error" role="alert" hidden></div>
  <section id="report" class="report" hidden aria-label="Audit report"></section>
  <p class="cta">Want help fixing these issues? <a href="https://piotrmajkutewicz.pl" rel="noopener">Talk to Piotr Majkutewicz.</a></p>
  <p class="note muted" id="disclaimer">This is an automated, unofficial and simplified check of a single page. It is not a replacement for a full audit.</p>
</main>
<script nonce="__NONCE__">
(function () {
  var form = document.getElementById("form");
  var input = document.getElementById("url");
  var go = document.getElementById("go");
  var statusEl = document.getElementById("status");
  var errorEl = document.getElementById("error");
  var reportEl = document.getElementById("report");
  var disclaimerEl = document.getElementById("disclaimer");

  // el("tag", {class: "x"}, "text" | [children]) builds nodes with textContent only.
  function el(tag, attrs, content) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (typeof content === "string") n.textContent = content;
    else if (content) content.forEach(function (c) { n.appendChild(c); });
    return n;
  }
  var LABEL = { high: "High", medium: "Medium", low: "Low" };

  function render(r) {
    reportEl.replaceChildren();
    reportEl.appendChild(el("p", { class: "muted" }, "Report for " + r.url));
    reportEl.appendChild(el("div", { class: "score" }, [
      el("strong", null, String(r.score)),
      el("span", null, "out of 100 (overall score of this tool, not an official rating)")
    ]));
    reportEl.appendChild(el("ul", { class: "cats" }, r.categories.map(function (c) {
      return el("li", null, [el("b", null, String(c.score)), el("span", { class: "muted" }, c.name)]);
    })));

    reportEl.appendChild(el("h2", null, "Things to fix (" + r.findings.length + ")"));
    if (r.findings.length === 0) reportEl.appendChild(el("p", null, "No problems found by these checks."));
    r.findings.forEach(function (f) {
      var title = f.title + (f.detail ? " (" + f.detail + ")" : "");
      reportEl.appendChild(el("article", { class: "finding " + f.severity }, [
        el("h3", null, [el("span", { class: "badge" }, LABEL[f.severity] || f.severity), document.createTextNode(title)]),
        el("p", null, [el("strong", null, "Why it matters: "), document.createTextNode(f.why)]),
        el("p", null, [el("strong", null, "What to do: "), document.createTextNode(f.fix)])
      ]));
    });

    reportEl.appendChild(el("h2", null, "Checks passed (" + r.passed.length + ")"));
    reportEl.appendChild(el("ul", { class: "plain passed" }, r.passed.map(function (p) { return el("li", null, p.title); })));

    reportEl.appendChild(el("h2", null, "What this tool does NOT check"));
    reportEl.appendChild(el("ul", { class: "plain" }, r.notChecked.map(function (t) { return el("li", null, t); })));
    disclaimerEl.textContent = r.disclaimer;
    reportEl.hidden = false;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    errorEl.hidden = true;
    reportEl.hidden = true;
    go.disabled = true;
    statusEl.textContent = "Checking the site, this can take several seconds...";
    fetch("/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: input.value })
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (r) {
      if (r.ok && r.data) render(r.data);
      else {
        errorEl.textContent = (r.data && r.data.error && r.data.error.message) || "Something went wrong. Please try again.";
        errorEl.hidden = false;
      }
    }).catch(function () {
      errorEl.textContent = "Could not reach the audit service. Check your connection and try again.";
      errorEl.hidden = false;
    }).then(function () {
      go.disabled = false;
      statusEl.textContent = "";
    });
  });
})();
</script>
</body>
</html>`;
