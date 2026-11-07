import { readFileSync } from "node:fs";
import type { AuditInput } from "../src/types";

export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

export const GOOD_HEADERS: Record<string, string> = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "content-security-policy": "default-src 'self'; frame-ancestors 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=()",
  "content-encoding": "br",
  "cache-control": "max-age=300",
};

export function makeInput(over: Partial<AuditInput> = {}): AuditInput {
  const html = over.html ?? "";
  return {
    requestedUrl: "https://greendoor.example/",
    finalUrl: "https://greendoor.example/",
    status: 200,
    headers: {},
    html,
    htmlBytes: new TextEncoder().encode(html).length,
    truncated: false,
    responseTimeMs: 200,
    redirectCount: 0,
    httpRedirect: { redirectsToHttps: true },
    setCookies: [],
    robotsTxt: { found: true, hasSitemapLine: true, blocksAll: false },
    sitemapXml: { found: true, info: { wellFormed: true, kind: "urlset", count: 3, hasHome: true, truncated: false } },
    securityTxt: null,
    faviconFile: null,
    wwwVariant: { tested: false, sameTarget: null },
    linkSample: null,
    resourceSample: null,
    requests: 1,
    hosts: ["greendoor.example"],
    ...over,
  };
}
