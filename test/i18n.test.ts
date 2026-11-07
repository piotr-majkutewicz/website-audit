import { describe, expect, it } from "vitest";
import { CHECKS } from "../src/audit";
import { parseHtml } from "../src/html";
import { dictionary, ERROR_KEYS, FINDING_KEYS, format, LANGS, PASSED_IDS, UI_KEYS } from "../src/i18n";
import { analyze } from "../src/audit";
import { fixture, GOOD_HEADERS, makeInput } from "./helpers";
import type { AuditInput } from "../src/types";

const BAD_TEXT = /\{\w+\}|undefined|\bTODO\b|\bTBD\b|lorem|xxx|\[object/i;

function texts(lang: (typeof LANGS)[number]): [string, string][] {
  const d = dictionary(lang);
  const out: [string, string][] = [];
  for (const k of FINDING_KEYS) {
    const f = d.findings[k];
    out.push([`finding ${k} title`, f.title], [`finding ${k} why`, f.why], [`finding ${k} fix`, f.fix]);
    if (f.detail !== undefined) out.push([`finding ${k} detail`, f.detail]);
  }
  for (const k of PASSED_IDS) out.push([`passed ${k}`, d.passed[k]]);
  for (const k of ERROR_KEYS) out.push([`error ${k}`, d.errors[k]]);
  for (const k of UI_KEYS) out.push([`ui ${k}`, d.ui[k]]);
  for (const [k, v] of Object.entries(d.categories)) out.push([`category ${k}`, v]);
  d.notChecked.forEach((v, i) => out.push([`notChecked ${i}`, v]));
  out.push(["disclaimer", d.disclaimer]);
  return out;
}

describe("dictionaries", () => {
  it("have the same shape in every language", () => {
    const [a, b] = LANGS.map(dictionary) as [ReturnType<typeof dictionary>, ReturnType<typeof dictionary>];
    expect(Object.keys(a.findings).sort()).toEqual([...FINDING_KEYS].sort());
    expect(Object.keys(b.findings).sort()).toEqual([...FINDING_KEYS].sort());
    expect(Object.keys(a.passed).sort()).toEqual([...PASSED_IDS].sort());
    expect(Object.keys(b.passed).sort()).toEqual([...PASSED_IDS].sort());
    expect(Object.keys(a.errors).sort()).toEqual([...ERROR_KEYS].sort());
    expect(Object.keys(b.errors).sort()).toEqual([...ERROR_KEYS].sort());
    expect(Object.keys(a.ui).sort()).toEqual([...UI_KEYS].sort());
    expect(Object.keys(b.ui).sort()).toEqual([...UI_KEYS].sort());
    expect(a.notChecked.length).toBe(b.notChecked.length);
    for (const k of FINDING_KEYS) expect(a.findings[k].detail === undefined, k).toBe(b.findings[k].detail === undefined);
  });

  for (const lang of LANGS) {
    it(`have no empty or placeholder texts (${lang})`, () => {
      for (const [name, text] of texts(lang)) {
        expect(text.trim().length, name).toBeGreaterThan(1);
        // Templates may contain {name}; only leftovers of other kinds are errors here.
        expect(text.replace(/\{\w+\}/g, ""), name).not.toMatch(BAD_TEXT);
        expect(text, name).not.toMatch(/[–—]/); // no en or em dashes
      }
    });
  }

  it("do not copy English text into the Polish dictionary", () => {
    const pl = dictionary("pl");
    const en = dictionary("en");
    for (const k of FINDING_KEYS) {
      expect(pl.findings[k].title, k).not.toBe(en.findings[k].title);
      expect(pl.findings[k].why, k).not.toBe(en.findings[k].why);
      expect(pl.findings[k].fix, k).not.toBe(en.findings[k].fix);
    }
    for (const k of PASSED_IDS) expect(pl.passed[k], k).not.toBe(en.passed[k]);
    for (const k of ERROR_KEYS) expect(pl.errors[k], k).not.toBe(en.errors[k]);
    expect(pl.disclaimer).not.toBe(en.disclaimer);
  });

  it("use the same placeholders in both languages", () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const pl = dictionary("pl");
    const en = dictionary("en");
    for (const k of FINDING_KEYS) {
      expect(names(pl.findings[k].detail ?? ""), k).toEqual(names(en.findings[k].detail ?? ""));
    }
    for (const k of UI_KEYS) expect(names(pl.ui[k]), k).toEqual(names(en.ui[k]));
  });

  it("format() fills placeholders", () => {
    expect(format("{a} of {b}", { a: 1, b: "x" })).toBe("1 of x");
  });
});

describe("coverage of the checks", () => {
  const goodHtml = fixture("good.html");
  const page = (head: string, body = "<h1>Heading</h1>") =>
    `<html lang="en"><head><meta name="viewport" content="width=device-width">${head}</head><body>${body}</body></html>`;
  const scripts = (n: number) => Array.from({ length: n }, (_, i) => `<script src="/s${i}.js" defer></script>`).join("");
  const styles = (n: number) => Array.from({ length: n }, (_, i) => `<link rel="stylesheet" href="/c${i}.css">`).join("");
  const goodWith = (over: Partial<AuditInput>) => makeInput({ html: goodHtml, headers: GOOD_HEADERS, ...over });

  const scenarios: AuditInput[] = [
    makeInput({
      html: fixture("bad.html"), finalUrl: "https://bad.example/", headers: {},
      httpRedirect: { redirectsToHttps: false }, robotsTxt: { found: false, hasSitemapLine: false }, sitemapXml: { found: false },
    }),
    goodWith({ finalUrl: "http://greendoor.example/", httpRedirect: null }),
    goodWith({ headers: { ...GOOD_HEADERS, "strict-transport-security": "max-age=300" }, truncated: true, responseTimeMs: 3000 }),
    goodWith({ htmlBytes: 600_000, responseTimeMs: 1000, status: 404 }),
    goodWith({ htmlBytes: 250_000 }),
    goodWith({ htmlBytes: 50_000, headers: { ...GOOD_HEADERS, "content-encoding": "identity" } }),
    goodWith({ htmlBytes: 50_000, headers: { ...GOOD_HEADERS, "content-encoding": "" } }),
    makeInput({ html: page("<title>Hi</title><meta name=\"description\" content=\"short\">"), headers: GOOD_HEADERS }),
    makeInput({ html: page(`<title>${"T".repeat(80)}</title><meta name="description" content="${"d".repeat(200)}">`), headers: GOOD_HEADERS }),
    makeInput({ html: page("", "<h1>A</h1><h1>B</h1>"), headers: GOOD_HEADERS }),
    makeInput({ html: page("", "<p>No heading</p>"), headers: GOOD_HEADERS }),
    makeInput({ html: page(scripts(16) + styles(9)), headers: GOOD_HEADERS }),
    makeInput({ html: page("").replace('lang="en"', 'lang="not valid!"'), headers: GOOD_HEADERS }),
    makeInput({ html: page("").replace(' lang="en"', ""), headers: GOOD_HEADERS }),
  ];

  it("every finding the checks can produce has a text in both languages", () => {
    const seen = new Set<string>();
    for (const input of scenarios) {
      const doc = parseHtml(input.html);
      for (const check of CHECKS) for (const f of check(input, doc).findings) seen.add(f.key);
    }
    expect([...seen].sort()).toEqual([...FINDING_KEYS].sort());
  });

  it("every passed check has a text, and every text is fully filled in", () => {
    const passed = new Set<string>();
    const good = goodWith({});
    for (const check of CHECKS) for (const p of check(good, parseHtml(good.html)).passed) passed.add(p.id);
    expect([...passed].sort()).toEqual([...PASSED_IDS].sort());

    for (const lang of LANGS) {
      for (const input of scenarios) {
        const r = analyze(input, new Date(), lang);
        for (const f of r.findings) {
          for (const text of [f.title, f.why, f.fix, f.detail ?? "x"]) expect(text, `${lang} ${f.id}`).not.toMatch(BAD_TEXT);
        }
        for (const p of r.passed) expect(p.title).not.toMatch(BAD_TEXT);
      }
    }
  });

  it("keeps the same stable ids in every language", () => {
    for (const input of scenarios) {
      const ids = (l: "pl" | "en") => analyze(input, new Date(), l).findings.map((f) => f.id);
      expect(ids("pl")).toEqual(ids("en"));
    }
  });
});
