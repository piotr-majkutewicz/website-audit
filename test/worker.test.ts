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
});
