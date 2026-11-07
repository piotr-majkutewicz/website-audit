import { describe, expect, it } from "vitest";
import { analyze } from "../src/audit";
import { parseHtml } from "../src/html";
import { fixture, GOOD_HEADERS, makeInput } from "./helpers";

const ids = (r: ReturnType<typeof analyze>) => r.findings.map((f) => f.id);

describe("parseHtml", () => {
  it("ignores tags inside scripts and comments, decodes entities", () => {
    const doc = parseHtml(`<!-- <h1>no</h1> --><title>A &amp; B</title><script>"<h1>x</h1>"</script><h2>Hello <b>there</b></h2>`);
    expect(doc.title).toBe("A & B");
    expect(doc.headings).toEqual([{ level: 2, text: "Hello there" }]);
  });
  it("handles unquoted and single quoted attributes and duplicates", () => {
    const doc = parseHtml(`<img src=a.jpg alt='x y' alt="second">`);
    expect(doc.tags[0]!.attrs).toEqual({ src: "a.jpg", alt: "x y" });
  });
});

describe("analyze on a good page", () => {
  const report = analyze(makeInput({ html: fixture("good.html"), headers: GOOD_HEADERS }));
  it("finds no problems and scores 100", () => {
    expect(ids(report)).toEqual([]);
    expect(report.score).toBe(100);
    expect(report.categories.every((c) => c.score === 100)).toBe(true);
  });
  it("lists passed checks and the not-checked section", () => {
    expect(report.passed.length).toBeGreaterThan(15);
    expect(report.notChecked.length).toBeGreaterThan(3);
    expect(report.disclaimer).toMatch(/nieoficjalne/);
    expect(analyze(makeInput({ html: fixture("good.html"), headers: GOOD_HEADERS }), new Date(), "en").disclaimer).toMatch(/unofficial/);
  });
});

describe("analyze on a bad page", () => {
  const badInput = makeInput({
    html: fixture("bad.html"),
    finalUrl: "https://bad.example/",
    headers: {},
    httpRedirect: { redirectsToHttps: false },
    robotsTxt: { found: false, hasSitemapLine: false },
    sitemapXml: { found: false },
  });
  const report = analyze(badInput);
  const found = ids(report);
  it("reports the expected problems", () => {
    for (const id of [
      "http-redirect", "hsts", "csp", "xcto", "framing", "referrer-policy", "permissions-policy", "mixed-content",
      "title-length", "description", "h1", "canonical", "viewport", "open-graph", "noindex", "robots-txt", "sitemap",
      "cache-control", "blocking-scripts", "img-dimensions", "lang", "img-alt", "form-labels", "heading-order",
    ]) expect(found, id).toContain(id);
  });
  it("counts things correctly", () => {
    const get = (id: string) => report.findings.find((f) => f.id === id)!;
    expect(get("img-alt").detail).toBe("obrazów: 2 z 2");
    expect(get("form-labels").detail).toBe("pól: 2 z 2");
    expect(get("h1").detail).toBe("liczba nagłówków H1: 2");
    expect(get("img-dimensions").detail).toBe("obrazów: 2 z 2");
  });
  it("gives the same counts in English", () => {
    const en = analyze(badInput, new Date(), "en");
    const get = (id: string) => en.findings.find((f) => f.id === id)!;
    expect(get("img-alt").detail).toBe("2 of 2 images");
    expect(get("form-labels").detail).toBe("2 of 2 fields");
    expect(get("h1").detail).toBe("H1 count: 2");
    expect(en.findings.map((f) => f.id)).toEqual(report.findings.map((f) => f.id));
  });
  it("sorts by severity and keeps the score within 0..100", () => {
    const order = { high: 0, medium: 1, low: 2 };
    const sev = report.findings.map((f) => order[f.severity]);
    expect([...sev].sort()).toEqual(sev);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThan(40);
  });
});

describe("individual rules", () => {
  const base = fixture("good.html");
  const run = (over: Parameters<typeof makeInput>[0]) => ids(analyze(makeInput({ html: base, headers: GOOD_HEADERS, ...over })));

  it("flags HTTP pages and skips HSTS/mixed content for them", () => {
    const found = run({ finalUrl: "http://greendoor.example/", httpRedirect: null });
    expect(found).toContain("https");
    expect(found).not.toContain("hsts");
  });
  it("flags weak HSTS", () => {
    expect(run({ headers: { ...GOOD_HEADERS, "strict-transport-security": "max-age=300" } })).toContain("hsts");
  });
  it("accepts X-Frame-Options instead of frame-ancestors", () => {
    const headers = { ...GOOD_HEADERS, "content-security-policy": "default-src 'self'", "x-frame-options": "DENY" };
    expect(run({ headers })).not.toContain("framing");
  });
  it("flags missing compression only for larger pages", () => {
    const { ["content-encoding"]: _drop, ...noEnc } = GOOD_HEADERS;
    expect(run({ headers: noEnc, htmlBytes: 50_000 })).toContain("compression");
    expect(run({ headers: noEnc, htmlBytes: 2_000 })).not.toContain("compression");
  });
  it("flags big, truncated and slow responses", () => {
    expect(run({ htmlBytes: 600_000 })).toContain("html-size");
    const truncated = analyze(makeInput({ html: base, headers: GOOD_HEADERS, truncated: true }));
    expect(truncated.findings.find((f) => f.id === "html-size")!.severity).toBe("high");
    const slow = analyze(makeInput({ html: base, headers: GOOD_HEADERS, responseTimeMs: 3000 }));
    expect(slow.findings.find((f) => f.id === "response-time")!.severity).toBe("medium");
  });
  it("detects noindex from the X-Robots-Tag header", () => {
    expect(run({ headers: { ...GOOD_HEADERS, "x-robots-tag": "noindex" } })).toContain("noindex");
  });
  it("takes a sitemap line in robots.txt as enough", () => {
    expect(run({ sitemapXml: { found: false }, robotsTxt: { found: true, hasSitemapLine: true } })).not.toContain("sitemap");
  });
  it("flags error status codes", () => {
    expect(run({ status: 404 })).toContain("status");
  });
  it("treats label wrapping and aria-label as labelled", () => {
    const html = `<html lang="en"><body><label>A <input></label><input aria-label="B"><input id="c"><label for="c">C</label></body></html>`;
    expect(ids(analyze(makeInput({ html, headers: GOOD_HEADERS })))).not.toContain("form-labels");
  });
});
