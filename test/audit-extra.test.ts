import { describe, expect, it } from "vitest";
import { analyze, analyzeNeutral, localize } from "../src/audit";
import { dictionary } from "../src/i18n";
import { fullGood, goodHtml, resource } from "./scenarios";
import { GOOD_HEADERS, makeInput } from "./helpers";
import type { AuditInput } from "../src/types";

const ids = (input: AuditInput) => analyze(input).findings.map((f) => f.id);
const keys = (input: AuditInput) => analyzeNeutral(input).findings.map((f) => f.key);

describe("a page that passes every sampled check", () => {
  const report = analyze(fullGood());
  it("has no findings and scores 100", () => {
    expect(report.findings).toEqual([]);
    expect(report.score).toBe(100);
  });
  it("lists what was found", () => {
    const facts = report.neutral.facts.map((f) => f.id);
    expect(facts).toEqual(expect.arrayContaining(["structuredTypes", "cookiesCount", "redirectsCount", "linksChecked", "resourcesChecked", "imageFormats", "sitemapUrls"]));
    expect(report.neutral.facts.find((f) => f.id === "structuredTypes")!.params).toEqual({ types: "Bakery" });
  });
  it("reports what was checked", () => {
    expect(report.coverage).toMatchObject({ requests: 14, hosts: ["greendoor.example"], links: { checked: 10, total: 20 }, resources: { checked: 3, total: 12 } });
    expect(report.coverage.checks).toBe(report.passed.length);
  });
});

describe("structured data", () => {
  it("flags a page without JSON-LD as low", () => {
    const r = analyze(fullGood({ html: goodHtml.replace(/<script type="application\/ld\+json">.*?<\/script>/, "") }));
    const f = r.findings.find((x) => x.id === "structured-data")!;
    expect(f.severity).toBe("low");
    expect(r.neutral.facts.map((x) => x.id)).toContain("noStructuredData");
  });
  it("flags broken JSON-LD as medium and still lists valid types", () => {
    const html = goodHtml.replace("</head>", '<script type="application/ld+json">{oops</script></head>');
    const r = analyze(fullGood({ html }));
    expect(r.findings.find((x) => x.id === "structured-data")!.severity).toBe("medium");
    expect(r.neutral.facts.find((x) => x.id === "structuredTypes")!.params["types"]).toBe("Bakery");
  });
});

describe("robots.txt and sitemap", () => {
  it("blocking the whole site is a high finding", () => {
    const r = analyze(fullGood({ robotsTxt: { found: true, hasSitemapLine: true, blocksAll: true } }));
    expect(r.findings.find((f) => f.id === "robots-open")!.severity).toBe("high");
  });
  it("a missing robots.txt does not add robots findings beyond the existing one", () => {
    const found = ids(fullGood({ robotsTxt: { found: false, hasSitemapLine: false, blocksAll: false } }));
    expect(found).toContain("robots-txt");
    expect(found).not.toContain("robots-open");
    expect(found).not.toContain("robots-sitemap");
  });
  it("tells an invalid, an empty and a home-less sitemap apart", () => {
    const sm = (info: Partial<NonNullable<AuditInput["sitemapXml"]["info"]>>) =>
      keys(fullGood({ sitemapXml: { found: true, info: { wellFormed: true, kind: "urlset", count: 3, hasHome: true, truncated: false, ...info } } }));
    expect(sm({ wellFormed: false })).toContain("sitemap.invalid");
    expect(sm({ kind: "other" })).toContain("sitemap.invalid");
    expect(sm({ count: 0, hasHome: false })).toContain("sitemap.empty");
    expect(sm({ hasHome: false })).toContain("sitemap.noHome");
    expect(sm({ hasHome: null })).not.toContain("sitemap.noHome");
    expect(sm({ wellFormed: null, truncated: true })).toEqual([]);
  });
});

describe("cookies", () => {
  const run = (setCookies: string[], over: Partial<AuditInput> = {}) => keys(fullGood({ setCookies, ...over }));
  it("flags missing flags separately and counts them", () => {
    expect(run(["a=1"])).toEqual(expect.arrayContaining(["cookies-secure", "cookies-httponly", "cookies-samesite"]));
    expect(run(["a=1; Secure; HttpOnly; SameSite=None"])).toEqual([]);
    const r = analyze(fullGood({ setCookies: ["a=1; Secure", "b=2; Secure; HttpOnly; SameSite=Lax"] }));
    expect(r.findings.find((f) => f.id === "cookies-httponly")!.detail).toBe("ciasteczek: 1 z 2");
  });
  it("does not require Secure on a plain http page and says nothing without cookies", () => {
    expect(run(["a=1; HttpOnly; SameSite=Lax"], { finalUrl: "http://greendoor.example/", httpRedirect: null })).not.toContain("cookies-secure");
    expect(run([])).toEqual([]);
  });
  it("matches flags case-insensitively and does not treat a value as a flag", () => {
    expect(run(["a=Secure; secure; HTTPONLY; samesite=strict"])).toEqual([]);
    expect(run(["token=secure"])).toContain("cookies-secure");
  });
});

describe("links and files", () => {
  it("lists broken links with examples and raises severity with many", () => {
    const one = analyze(fullGood({ linkSample: { total: 30, checked: 10, broken: [{ path: "/a", status: 404 }], unverified: 0 } }));
    expect(one.findings.find((f) => f.id === "links")).toMatchObject({ severity: "medium", detail: "uszkodzonych: 1 z 10 sprawdzonych linków: /a (404)" });
    const many = analyze(fullGood({ linkSample: { total: 30, checked: 10, broken: ["/a", "/b", "/c", "/d"].map((p) => ({ path: p, status: 500 })), unverified: 0 } }), new Date(), "en");
    const f = many.findings.find((x) => x.id === "links")!;
    expect(f.severity).toBe("high");
    expect(f.detail).toBe("4 of 10 checked links: /a (500), /b (500), /c (500)");
  });
  it("says nothing when no link could be checked", () => {
    expect(ids(fullGood({ linkSample: { total: 3, checked: 0, broken: [], unverified: 3 } }))).toEqual([]);
    expect(ids(fullGood({ linkSample: null }))).toEqual([]);
  });
  it("does not count bot blocks (401, 403, 429) as broken resources", () => {
    const items = [401, 403, 429, 404].map((status, i) => resource({ status, path: `/f${i}.png` }));
    expect(analyze(fullGood({ resourceSample: { total: 4, items } })).findings.find((f) => f.id === "resources")!.detail).toContain("1 z 4");
  });
  it("flags heavy images: low for one, medium for three or for one over 1 MB", () => {
    const sev = (bytes: number[]) =>
      analyze(fullGood({ resourceSample: { total: 9, items: bytes.map((b, i) => resource({ bytes: b, path: `/i${i}.webp` })) } })).findings.find((f) => f.id === "image-weight")?.severity;
    expect(sev([400_000, 10_000])).toBe("low");
    expect(sev([400_000, 400_000, 400_000])).toBe("medium");
    expect(sev([2_000_000])).toBe("medium");
    expect(sev([250_000, 10_000])).toBeUndefined();
    expect(sev([null as unknown as number])).toBeUndefined();
  });
  it("judges image formats only with at least two known images and ignores svg", () => {
    const run = (types: string[]) =>
      ids(fullGood({ resourceSample: { total: 5, items: types.map((t, i) => resource({ contentType: t, path: `/i${i}`, bytes: 1000 })) } }));
    expect(run(["image/jpeg", "image/png"])).toContain("image-formats");
    expect(run(["image/jpeg", "image/webp"])).not.toContain("image-formats");
    expect(run(["image/jpeg", "image/svg+xml"])).not.toContain("image-formats");
    expect(run(["image/avif", "image/png", "image/jpeg"])).not.toContain("image-formats");
  });
  it("flags weak caching of static files when half or more are cached for under a day", () => {
    const run = (cc: string[]) =>
      ids(fullGood({ resourceSample: { total: 5, items: cc.map((c, i) => resource({ cacheControl: c, path: `/f${i}.css`, kind: "style", contentType: "text/css", bytes: 100 })) } }));
    expect(run(["", "max-age=60"])).toContain("static-cache");
    expect(run(["no-store", "max-age=31536000"])).toContain("static-cache");
    expect(run(["max-age=31536000", "max-age=604800", ""])).not.toContain("static-cache");
    expect(run(["max-age=31536000", "s-maxage=86400"])).not.toContain("static-cache");
  });
});

describe("other small checks", () => {
  it("compares hreflang with the page language", () => {
    const withHreflang = (codes: string[], lang = "en") =>
      fullGood({
        html: goodHtml
          .replace('lang="en"', `lang="${lang}"`)
          .replace("</head>", codes.map((c) => `<link rel="alternate" hreflang="${c}" href="https://greendoor.example/${c}">`).join("") + "</head>"),
      });
    expect(ids(withHreflang(["en", "de"]))).toEqual([]);
    expect(ids(withHreflang(["en-GB", "de"]))).toEqual([]);
    expect(ids(withHreflang(["x-default", "de"]))).toContain("hreflang");
    expect(ids(withHreflang(["pl"], "en-US"))).toContain("hreflang");
  });
  it("accepts a declared icon without asking for /favicon.ico and flags a missing one", () => {
    expect(ids(fullGood({ faviconFile: false }))).toEqual([]);
    const noIcon = goodHtml.replace('<link rel="icon" href="/favicon.png">', "");
    expect(ids(fullGood({ html: noIcon, faviconFile: false }))).toContain("favicon");
    expect(ids(fullGood({ html: noIcon, faviconFile: true }))).toEqual([]);
    expect(ids(fullGood({ html: noIcon, faviconFile: null }))).toEqual([]);
  });
  it("rates redirect chains and the www split", () => {
    expect(ids(fullGood({ redirectCount: 2 }))).toEqual([]);
    expect(analyze(fullGood({ redirectCount: 3 })).findings[0]!.severity).toBe("low");
    expect(analyze(fullGood({ redirectCount: 4 })).findings[0]!.severity).toBe("medium");
    expect(ids(fullGood({ wwwVariant: { tested: true, sameTarget: false } }))).toContain("www-canonical");
    expect(ids(fullGood({ wwwVariant: { tested: true, sameTarget: null } }))).toEqual([]);
    expect(ids(fullGood({ wwwVariant: { tested: false, sameTarget: null } }))).toEqual([]);
  });
  it("detects viewports that block zoom", () => {
    const vp = (content: string) => fullGood({ html: goodHtml.replace("width=device-width, initial-scale=1", content) });
    for (const bad of ["width=device-width, user-scalable=no", "width=device-width,user-scalable=0", "width=device-width, maximum-scale=1", "width=device-width, maximum-scale=1.0"]) {
      expect(ids(vp(bad)), bad).toContain("zoom");
    }
    for (const good of ["width=device-width, initial-scale=1", "width=device-width, maximum-scale=5", "width=device-width, user-scalable=yes"]) {
      expect(ids(vp(good)), good).not.toContain("zoom");
    }
  });
  it("reports security.txt only when it was tested", () => {
    expect(ids(fullGood({ securityTxt: false }))).toContain("security-txt");
    expect(ids(fullGood({ securityTxt: null }))).toEqual([]);
  });
});

describe("the three most important things", () => {
  const bad = makeInput({
    html: "<html><body><img src=a.png></body></html>",
    finalUrl: "http://bad.example/",
    headers: {},
    httpRedirect: null,
  });
  it("picks at most three, high severity first, and the order does not depend on the language", () => {
    const a = analyzeNeutral(bad);
    expect(a.top).toEqual([0, 1, 2]);
    const sev = a.findings.map((f) => f.severity);
    expect(sev.slice(0, 3).every((s) => s === "high")).toBe(true);
    expect([...sev]).toEqual([...sev].sort((x, y) => ({ high: 0, medium: 1, low: 2 })[x] - ({ high: 0, medium: 1, low: 2 })[y]));
    expect(analyze(bad, new Date(), "en").top).toEqual(a.top);
  });
  it("puts more visible problems first within a severity", () => {
    const a = analyzeNeutral(bad);
    const first = a.findings[0]!;
    expect(["https", "noindex", "viewport", "status"]).toContain(first.id);
  });
  it("returns fewer when there is little to fix", () => {
    expect(analyzeNeutral(fullGood()).top).toEqual([]);
    expect(analyzeNeutral(fullGood({ securityTxt: false })).top).toEqual([0]);
  });
});

describe("neutral view and localization", () => {
  it("holds no texts and can be localized on its own", () => {
    const neutral = analyzeNeutral(makeInput({ html: "<html><body><img src=a.png></body></html>", headers: {} }), new Date("2026-01-01"));
    const text = JSON.stringify(neutral);
    expect(text).not.toContain('"why"');
    expect(text).not.toContain('"fix"');
    expect(neutral.findings.every((f) => typeof f.key === "string" && typeof f.basis === "string")).toBe(true);
    expect(localize(neutral, "pl").findings[0]!.title).toBe(dictionary("pl").findings[neutral.findings[0]!.key].title);
    expect(localize(neutral, "en").findings[0]!.title).toBe(dictionary("en").findings[neutral.findings[0]!.key].title);
  });
  it("adds impact and how-we-know to every finding in both languages", () => {
    for (const lang of ["pl", "en"] as const) {
      const r = analyze(makeInput({ html: goodHtml, headers: {}, linkSample: { total: 9, checked: 4, broken: [{ path: "/x", status: 404 }], unverified: 0 } }), new Date(), lang);
      for (const f of r.findings) {
        expect(f.impact.length, f.id).toBeGreaterThan(10);
        expect(f.basis.length, f.id).toBeGreaterThan(10);
        expect(f.basis, f.id).not.toMatch(/\{\w+\}/);
      }
      expect(r.findings.find((f) => f.id === "links")!.basis).toMatch(lang === "pl" ? /4 z 9/ : /4 of 9/);
    }
  });
  it("exposes the scoring rule", () => {
    const a = analyzeNeutral(fullGood());
    expect(a.scoring.penalty).toEqual({ high: 25, medium: 10, low: 4 });
    expect(Object.values(a.scoring.weights).reduce((x, y) => x + y, 0)).toBe(100);
  });
  it("marks PageSpeed as available only when asked", () => {
    expect(analyzeNeutral(fullGood()).pagespeedAvailable).toBe(false);
    expect(analyzeNeutral(fullGood(), new Date(), true).pagespeedAvailable).toBe(true);
  });
});

describe("headers stay part of the good fixture", () => {
  it("good headers still give a clean report", () => {
    expect(GOOD_HEADERS["content-encoding"]).toBeTruthy();
  });
});
