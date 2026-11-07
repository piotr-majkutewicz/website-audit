import { describe, expect, it } from "vitest";
import { parseHtml } from "../src/html";
import { inspectJsonLd } from "../src/jsonld";
import { parsePagespeed } from "../src/pagespeed";
import { parseRobots } from "../src/robots";
import { extractLinks, extractResources, pickResources, pickSample } from "../src/sample";
import { inspectSitemap, isWellFormedXml } from "../src/xml";

describe("JSON-LD", () => {
  it("lists the types, also from @graph, arrays and full schema.org addresses", () => {
    const doc = parseHtml(`<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"A"},{"@type":["LocalBusiness","Bakery"]},{"@type":"https://schema.org/FAQPage","mainEntity":[{"@type":"Question"}]}]}</script>
      <script type='application/ld+json'>{"@type":"Product"}</script>`);
    const info = inspectJsonLd(doc.jsonLd);
    expect(info.total).toBe(2);
    expect(info.invalid).toBe(0);
    expect(info.types).toEqual(["Organization", "LocalBusiness", "Bakery", "FAQPage", "Question", "Product"]);
  });
  it("counts broken JSON and keeps the valid blocks", () => {
    const info = inspectJsonLd(['{"@type":"Product"}', '{"@type": "Product",}', "", "[1,2"]);
    expect(info).toEqual({ total: 4, invalid: 3, types: ["Product"] });
  });
  it("ignores other scripts and survives deep or huge input", () => {
    const doc = parseHtml(`<script>var x={"@type":"Nope"}</script><script type="application/json">{}</script>`);
    expect(doc.jsonLd).toEqual([]);
    const deep = "[".repeat(5000) + "]".repeat(5000);
    expect(() => inspectJsonLd([deep])).not.toThrow();
    const many = JSON.stringify(Array.from({ length: 5000 }, (_, i) => ({ "@type": "T" + i })));
    expect(inspectJsonLd([many]).types.length).toBeLessThanOrEqual(12);
  });
  it("reads at most 20 blocks", () => {
    const html = Array.from({ length: 30 }, () => `<script type="application/ld+json">{}</script>`).join("");
    expect(parseHtml(html).jsonLd.length).toBe(20);
  });
});

describe("robots.txt", () => {
  it("detects a block of the whole site for all robots", () => {
    expect(parseRobots("User-agent: *\nDisallow: /").blocksAll).toBe(true);
    expect(parseRobots("User-agent: *\r\nDisallow: / # all\r\n").blocksAll).toBe(true);
  });
  it("does not flag partial blocks, other robots or an Allow override", () => {
    expect(parseRobots("User-agent: *\nDisallow: /admin/").blocksAll).toBe(false);
    expect(parseRobots("User-agent: BadBot\nDisallow: /").blocksAll).toBe(false);
    expect(parseRobots("User-agent: *\nDisallow: /\nAllow: /").blocksAll).toBe(false);
    expect(parseRobots("User-agent: *\nDisallow:").blocksAll).toBe(false);
  });
  it("handles groups with several agents and lists sitemaps", () => {
    const r = parseRobots("User-agent: Googlebot\nUser-agent: *\nDisallow: /\n\nUser-agent: x\nDisallow:\nSitemap: https://a.example/s.xml\nsitemap: https://a.example/t.xml");
    expect(r.blocksAll).toBe(true);
    expect(r.sitemapUrls).toEqual(["https://a.example/s.xml", "https://a.example/t.xml"]);
  });
});

describe("XML and sitemaps", () => {
  it("accepts well-formed documents", () => {
    expect(isWellFormedXml('<?xml version="1.0"?><!-- c --><urlset a="1"><url><loc>x</loc></url><empty/></urlset>')).toBe(true);
  });
  it("rejects broken documents", () => {
    for (const bad of ["", "text", "<a><b></a></b>", "<a>", "<a></a><b></b>", "<a></a> trailing", "<a>1 < 2</a>", "</a>"]) {
      expect(isWellFormedXml(bad), bad).toBe(false);
    }
  });
  const urlset = (locs: string[]) => `<?xml version="1.0"?><urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;
  it("counts addresses and finds the home page, ignoring www, scheme and a missing slash", () => {
    const info = inspectSitemap(urlset(["https://www.a.example/", "https://a.example/x"]), "https://a.example/", false);
    expect(info).toMatchObject({ wellFormed: true, kind: "urlset", count: 2, hasHome: true });
    expect(inspectSitemap(urlset(["https://a.example"]), "https://a.example/", false).hasHome).toBe(true);
    expect(inspectSitemap(urlset(["https://a.example/x"]), "https://a.example/", false).hasHome).toBe(false);
  });
  it("handles an empty sitemap, an index and invalid XML", () => {
    expect(inspectSitemap("<urlset></urlset>", "https://a.example/", false)).toMatchObject({ count: 0, wellFormed: true, hasHome: false });
    const index = inspectSitemap("<sitemapindex><sitemap><loc>https://a.example/s1.xml</loc></sitemap></sitemapindex>", "https://a.example/", false);
    expect(index).toMatchObject({ kind: "sitemapindex", count: 1, hasHome: null });
    expect(inspectSitemap("<urlset><url><loc>https://a.example/</loc></url>", "https://a.example/", false).wellFormed).toBe(false);
  });
  it("does not judge a truncated sitemap", () => {
    const info = inspectSitemap(urlset(["https://a.example/x"]).slice(0, 60), "https://a.example/", true);
    expect(info.wellFormed).toBeNull();
    expect(info.truncated).toBe(true);
  });
  it("reads a very large sitemap quickly", () => {
    const big = urlset(Array.from({ length: 40_000 }, (_, i) => `https://a.example/p/${i}`));
    const t = Date.now();
    const info = inspectSitemap(big, "https://a.example/", false);
    expect(info.count).toBe(40_000);
    expect(info.wellFormed).toBe(true);
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe("link and resource sampling", () => {
  const page = "https://site.example/blog/post";
  it("keeps same-site links only, once, without fragments and without the page itself", () => {
    const doc = parseHtml(`
      <a href="/a">1</a><a href="/a#top">dup</a><a href="https://www.site.example/b">www</a>
      <a href="https://other.example/x">other</a><a href="mailto:a@b.c">m</a><a href="tel:1">t</a>
      <a href="javascript:void(0)">j</a><a href="#section">h</a><a href="http://127.0.0.1/admin">ip</a>
      <a href="${page}">self</a><a href="c">relative</a><a>no href</a>`);
    expect(extractLinks(doc, page)).toEqual(["https://site.example/a", "https://www.site.example/b", "https://site.example/blog/c"]);
  });
  it("caps the number of candidates on a page with a huge number of links", () => {
    const html = Array.from({ length: 20_000 }, (_, i) => `<a href="/p${i}">x</a>`).join("");
    const links = extractLinks(parseHtml(html), page);
    expect(links.length).toBe(5000);
    expect(pickSample(links, 10).length).toBe(10);
  });
  it("picks images, styles and scripts of the same site", () => {
    const doc = parseHtml(`<img src="/a.jpg"><img src="data:image/png;base64,AAAA"><img src="https://cdn.other.example/x.png">
      <link rel="stylesheet" href="/s.css"><link rel="icon" href="/f.ico"><script src="/app.js"></script><script>inline()</script>`);
    expect(extractResources(doc, page)).toEqual([
      { url: "https://site.example/a.jpg", kind: "image" },
      { url: "https://site.example/s.css", kind: "style" },
      { url: "https://site.example/app.js", kind: "script" },
    ]);
  });
  it("samples evenly and deterministically", () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    expect(pickSample(items, 5)).toEqual([0, 20, 40, 60, 80]);
    expect(pickSample([1, 2], 5)).toEqual([1, 2]);
    expect(pickSample(items, 0)).toEqual([]);
  });
  it("mixes up to three styles and scripts with images, up to the limit", () => {
    const all = [
      ...Array.from({ length: 20 }, (_, i) => ({ url: `https://s.example/i${i}.jpg`, kind: "image" as const })),
      ...Array.from({ length: 6 }, (_, i) => ({ url: `https://s.example/f${i}.js`, kind: "script" as const })),
    ];
    const picked = pickResources(all, 8);
    expect(picked.length).toBe(8);
    expect(picked.filter((c) => c.kind === "script").length).toBe(3);
    expect(pickResources(all.slice(20), 8).length).toBe(6);
  });
});

describe("PageSpeed response", () => {
  const sample = {
    lighthouseResult: {
      fetchTime: "2026-11-07T10:00:00.000Z",
      categories: { performance: { score: 0.87 } },
      audits: {
        "largest-contentful-paint": { numericValue: 2310.4 },
        "cumulative-layout-shift": { numericValue: 0.031 },
        "total-blocking-time": { numericValue: 120 },
        "first-contentful-paint": { numericValue: 1200 },
      },
    },
    loadingExperience: { metrics: { INTERACTION_TO_NEXT_PAINT: { percentile: 180, category: "FAST" } } },
  };
  it("reads the values we show", () => {
    expect(parsePagespeed(sample)).toEqual({
      strategy: "mobile",
      score: 87,
      lcpMs: 2310.4,
      cls: 0.031,
      tbtMs: 120,
      fcpMs: 1200,
      inpMs: 180,
      fetchedAt: "2026-11-07T10:00:00.000Z",
    });
  });
  it("copes with missing field data and rejects unusable responses", () => {
    const { loadingExperience: _drop, ...noField } = sample;
    expect(parsePagespeed(noField)?.inpMs).toBeNull();
    expect(parsePagespeed({})).toBeNull();
    expect(parsePagespeed(null)).toBeNull();
    expect(parsePagespeed({ lighthouseResult: { ...sample.lighthouseResult, runtimeError: { code: "FAILED_DOCUMENT_REQUEST" } } })).toBeNull();
    expect(parsePagespeed({ lighthouseResult: { categories: { performance: { score: "x" } } } })).toBeNull();
  });
});
