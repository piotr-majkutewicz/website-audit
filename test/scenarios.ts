import type { AuditInput, ResourceInfo } from "../src/types";
import { fixture, GOOD_HEADERS, makeInput } from "./helpers";

export const goodHtml = fixture("good.html");

export function resource(over: Partial<ResourceInfo> = {}): ResourceInfo {
  return {
    path: "/a.webp",
    kind: "image",
    status: 200,
    contentType: "image/webp",
    bytes: 40_000,
    cacheControl: "public, max-age=31536000, immutable",
    hasExpires: false,
    hasEtag: true,
    ...over,
  };
}

/** A page where every new sampled check has data and passes. */
export function fullGood(over: Partial<AuditInput> = {}): AuditInput {
  return makeInput({
    html: goodHtml.replace("</head>", '<link rel="alternate" hreflang="en" href="https://greendoor.example/">\n</head>'),
    headers: GOOD_HEADERS,
    setCookies: ["sid=1; Path=/; Secure; HttpOnly; SameSite=Lax"],
    securityTxt: true,
    wwwVariant: { tested: true, sameTarget: true },
    linkSample: { total: 20, checked: 10, broken: [], unverified: 0 },
    resourceSample: { total: 12, items: [resource({ path: "/a.webp" }), resource({ path: "/b.jpg", contentType: "image/jpeg" }), resource({ path: "/main.css", kind: "style", contentType: "text/css", bytes: 2000 })] },
    requests: 14,
    hosts: ["greendoor.example"],
    ...over,
  });
}

const page = (head: string, body = "<h1>Heading</h1>") =>
  `<html lang="en"><head><meta name="viewport" content="width=device-width">${head}</head><body>${body}</body></html>`;
const scripts = (n: number) => Array.from({ length: n }, (_, i) => `<script src="/s${i}.js" defer></script>`).join("");
const styles = (n: number) => Array.from({ length: n }, (_, i) => `<link rel="stylesheet" href="/c${i}.css">`).join("");

/** Inputs that together trigger every finding the checks can produce. */
export const FAILING: AuditInput[] = [
  makeInput({
    html: fixture("bad.html"),
    finalUrl: "https://bad.example/",
    headers: {},
    httpRedirect: { redirectsToHttps: false },
    robotsTxt: { found: false, hasSitemapLine: false, blocksAll: false },
    sitemapXml: { found: false, info: null },
  }),
  fullGood({ finalUrl: "http://greendoor.example/", httpRedirect: null }),
  fullGood({ headers: { ...GOOD_HEADERS, "strict-transport-security": "max-age=300" }, truncated: true, responseTimeMs: 3000 }),
  fullGood({ htmlBytes: 600_000, responseTimeMs: 1000, status: 404 }),
  fullGood({ htmlBytes: 250_000 }),
  fullGood({ htmlBytes: 50_000, headers: { ...GOOD_HEADERS, "content-encoding": "identity" } }),
  fullGood({ htmlBytes: 50_000, headers: { ...GOOD_HEADERS, "content-encoding": "" } }),
  makeInput({ html: page('<title>Hi</title><meta name="description" content="short">'), headers: GOOD_HEADERS }),
  makeInput({ html: page(`<title>${"T".repeat(80)}</title><meta name="description" content="${"d".repeat(200)}">`), headers: GOOD_HEADERS }),
  makeInput({ html: page("", "<h1>A</h1><h1>B</h1>"), headers: GOOD_HEADERS }),
  makeInput({ html: page("", "<p>No heading</p>"), headers: GOOD_HEADERS }),
  makeInput({ html: page(scripts(16) + styles(9)), headers: GOOD_HEADERS }),
  makeInput({ html: page("").replace('lang="en"', 'lang="not valid!"'), headers: GOOD_HEADERS }),
  makeInput({ html: page("").replace(' lang="en"', ""), headers: GOOD_HEADERS }),
  // new checks
  fullGood({ setCookies: ["a=1", "b=2; Secure"] }),
  fullGood({ securityTxt: false }),
  fullGood({ html: page('<script type="application/ld+json">{broken</script>') }),
  fullGood({ robotsTxt: { found: true, hasSitemapLine: false, blocksAll: true } }),
  fullGood({ sitemapXml: { found: true, info: { wellFormed: false, kind: "urlset", count: 2, hasHome: true, truncated: false } } }),
  fullGood({ sitemapXml: { found: true, info: { wellFormed: true, kind: "urlset", count: 0, hasHome: false, truncated: false } } }),
  fullGood({ sitemapXml: { found: true, info: { wellFormed: true, kind: "urlset", count: 5, hasHome: false, truncated: false } } }),
  fullGood({ html: goodHtml.replace("</head>", '<link rel="alternate" hreflang="de" href="https://greendoor.example/de">\n</head>') }),
  fullGood({ html: page(""), faviconFile: false }),
  fullGood({ redirectCount: 3 }),
  fullGood({ wwwVariant: { tested: true, sameTarget: false } }),
  fullGood({ linkSample: { total: 30, checked: 10, broken: [{ path: "/gone", status: 404 }], unverified: 0 } }),
  fullGood({ resourceSample: { total: 5, items: [resource({ status: 404, path: "/missing.png" })] } }),
  fullGood({
    resourceSample: {
      total: 5,
      items: [resource({ bytes: 900_000 }), resource({ path: "/big.jpg", contentType: "image/jpeg", bytes: 2_000_000 })],
    },
  }),
  fullGood({
    resourceSample: {
      total: 5,
      items: [
        resource({ path: "/a.jpg", contentType: "image/jpeg", cacheControl: "" }),
        resource({ path: "/b.png", contentType: "image/png", cacheControl: "max-age=60" }),
      ],
    },
  }),
  fullGood({ html: goodHtml.replace("width=device-width, initial-scale=1", "width=device-width, user-scalable=no") }),
];
