import { describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";

const call = (path: string, init?: RequestInit, env: Env = {}) =>
  worker.fetch(new Request("https://audit.test" + path, init), env);
const post = (body: string, env?: Env) =>
  call("/api/audit", { method: "POST", body, headers: { "content-type": "application/json" } }, env);

describe("worker routes", () => {
  it("serves the UI with a strict CSP and a per-request nonce", async () => {
    const res = await call("/");
    const html = await res.text();
    const csp = res.headers.get("content-security-policy")!;
    const nonce = /nonce-([^']+)'/.exec(csp)![1]!;
    expect(html).toContain(`nonce="${nonce}"`);
    expect(html).not.toContain("__NONCE__");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(html).not.toMatch(/innerHTML/);
  });

  it("rejects private targets before any network access", async () => {
    const res = await post(JSON.stringify({ url: "http://127.0.0.1/" }));
    expect(res.status).toBe(400);
    expect((await res.json() as any).error.code).toBe("blocked_target");
  });

  it("validates the request body", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post(JSON.stringify({ url: 5 }))).status).toBe(400);
    expect((await post("x".repeat(5000))).status).toBe(413);
    expect((await call("/api/audit")).status).toBe(405);
    expect((await call("/nope")).status).toBe(404);
  });

  it("applies the rate limit binding when present and works without it", async () => {
    const denied: Env = { RATE_LIMITER: { limit: async () => ({ success: false }) } };
    const res = await post(JSON.stringify({ url: "http://127.0.0.1/" }), denied);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect((await post(JSON.stringify({ url: "http://127.0.0.1/" }), {})).status).toBe(400);
  });

  it("sends X-Robots-Tag noindex on every kind of response", async () => {
    const denied: Env = { RATE_LIMITER: { limit: async () => ({ success: false }) } };
    const responses = [
      await call("/"),
      await call("/", { method: "HEAD" }),
      await call("/robots.txt"),
      await call("/nope"),
      await call("/api/audit"),
      await post("not json"),
      await post("x".repeat(5000)),
      await post(JSON.stringify({ url: "http://127.0.0.1/" })),
      await post(JSON.stringify({ url: "http://127.0.0.1/" }), denied),
    ];
    for (const res of responses) expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("puts a robots meta tag in the page and allows crawling in robots.txt", async () => {
    const html = await (await call("/")).text();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    const robots = await call("/robots.txt");
    expect(await robots.text()).toBe("User-agent: *\nAllow: /\n");
    expect((await call("/sitemap.xml")).status).toBe(404);
  });

  it("links to the owner's site with rel=noopener and keeps the CSP free of external sources", async () => {
    const res = await call("/");
    const html = await res.text();
    expect(html).toContain('<a href="https://piotrmajkutewicz.pl" rel="noopener">');
    expect(html).toContain("Want help fixing these issues?");
    expect(html).not.toMatch(/<script[^>]+src=/i);
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/https?:/);
  });

  it("does not leak internal details on unexpected failures", async () => {
    const broken: Env = { RATE_LIMITER: { limit: async () => { throw new Error("secret internal detail"); } } };
    const res = await post(JSON.stringify({ url: "https://example.com/" }), broken);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("secret");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
});
