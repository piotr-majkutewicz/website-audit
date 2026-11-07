import { afterEach, describe, expect, it, vi } from "vitest";
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
    expect(html).toMatch(/<a href="https:\/\/piotrmajkutewicz\.pl" rel="noopener"[^>]*>Napisz do Piotra Majkutewicza\.<\/a>/);
    expect(html).toContain("Potrzebujesz pomocy z poprawkami?");
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

describe("languages", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubSite = () =>
    vi.stubGlobal(
      "fetch",
      async () => new Response("<html><head><title>Hi</title></head><body><img src=a.png></body></html>", { headers: { "content-type": "text/html" } }),
    );
  const audit = (extra: Record<string, unknown> = {}, query = "") =>
    call("/api/audit" + query, {
      method: "POST",
      body: JSON.stringify({ url: "https://example.com/", ...extra }),
      headers: { "content-type": "application/json" },
    });

  it("answers in Polish by default and in English on request, with the same stable ids", async () => {
    stubSite();
    const pl = (await (await audit()).json()) as any;
    const en = (await (await audit({ lang: "en" })).json()) as any;
    expect(pl.lang).toBe("pl");
    expect(en.lang).toBe("en");
    expect(pl.findings.map((f: any) => f.id)).toEqual(en.findings.map((f: any) => f.id));
    const plAlt = pl.findings.find((f: any) => f.id === "img-alt");
    const enAlt = en.findings.find((f: any) => f.id === "img-alt");
    expect(plAlt.title).toBe("Obrazy bez atrybutu alt");
    expect(enAlt.title).toBe("Images without an alt attribute");
    expect(plAlt.why).toBeTruthy();
    expect(plAlt.fix).toBeTruthy();
    expect(pl.categories.map((c: any) => c.name)).toContain("Podstawowe SEO");
    expect(en.categories.map((c: any) => c.name)).toContain("Basic SEO");
    expect(pl.notChecked[0]).not.toBe(en.notChecked[0]);
    expect(pl.disclaimer).toMatch(/nieoficjalne/);
  });

  it("rejects an unknown language with 400 instead of guessing", async () => {
    stubSite();
    for (const lang of ["de", "", 5, "PL"]) {
      const res = await audit({ lang });
      expect(res.status, String(lang)).toBe(400);
      expect(((await res.json()) as any).error.code).toBe("invalid_lang");
    }
  });

  it("localizes error messages, using ?lang= when the body has not been read yet", async () => {
    const msg = async (res: Response) => ((await res.json()) as any).error.message as string;
    const blocked = (extra: Record<string, unknown>, q = "") =>
      call("/api/audit" + q, { method: "POST", body: JSON.stringify({ url: "http://127.0.0.1/", ...extra }) });
    expect(await msg(await blocked({}))).toBe("Ten adres IP jest prywatny, lokalny lub zarezerwowany.");
    expect(await msg(await blocked({ lang: "en" }))).toBe("This IP address is private, loopback or reserved.");
    expect(await msg(await blocked({ lang: "en" }, "?lang=pl"))).toBe("This IP address is private, loopback or reserved.");
    expect(await msg(await call("/nope?lang=en"))).toBe("Not found.");
    expect(await msg(await call("/nope"))).toBe("Nie znaleziono.");
    expect(await msg(await call("/nope?lang=xx"))).toBe("Nie znaleziono.");
    const denied: Env = { RATE_LIMITER: { limit: async () => ({ success: false }) } };
    expect(await msg(await call("/api/audit?lang=en", { method: "POST", body: "{}" }, denied))).toMatch(/Too many requests/);
    expect(await msg(await call("/api/audit", { method: "POST", body: "{}" }, denied))).toMatch(/Zbyt wiele zapytań/);
    expect(await msg(await post("not json"))).toBe("Treść żądania musi być poprawnym JSON-em.");
  });

  it("renders the page in Polish by default and follows ?lang=", async () => {
    const html = async (path: string, headers: Record<string, string> = {}) => (await call(path, { headers })).text();
    // Browser language must not matter.
    const def = await html("/", { "accept-language": "en-US,en;q=0.9" });
    expect(def).toContain('<html lang="pl">');
    expect(def).toContain("Sprawdź stronę");
    const en = await html("/?lang=en");
    expect(en).toContain('<html lang="en">');
    expect(en).toContain("Run audit");
    expect(en).toContain("Want help fixing these issues?");
    expect(await html("/?lang=xx")).toContain('<html lang="pl">');
  });

  it("has an accessible language switch and a safe client script", async () => {
    const res = await call("/");
    const html = await res.text();
    expect(html).toMatch(/<div class="lang" role="group" aria-label="Język"/);
    expect(html).toMatch(/<button type="button" data-lang="pl" lang="pl" aria-label="Polski" aria-pressed="true">PL<\/button>/);
    expect(html).toMatch(/<button type="button" data-lang="en" lang="en" aria-label="English" aria-pressed="false">EN<\/button>/);
    expect(html).toContain("min-width:44px;min-height:44px");
    // Storage is optional, ?lang= wins over it, and nothing is written as HTML.
    expect(html).toMatch(/try \{ return window\.localStorage\.getItem\("lang"\)/);
    expect(html).toMatch(/try \{ window\.localStorage\.setItem\("lang"/);
    expect(html).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
    const nonce = /nonce-([^']+)'/.exec(res.headers.get("content-security-policy")!)![1]!;
    expect(html.split(`nonce="${nonce}"`).length - 1).toBe(2); // one style, one script
    expect(html).toContain('"pl":{');
    expect(html).toContain('"en":{');
  });
});
