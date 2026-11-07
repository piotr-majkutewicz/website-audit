import type { ParsedHtml } from "../html";
import type { AuditInput, CheckOutcome } from "../types";
import { Collector } from "./helpers";

const HSTS_MIN_SECONDS = 15_552_000; // 180 days

export function checkSecurity(input: AuditInput, doc: ParsedHtml): CheckOutcome {
  const c = new Collector("security");
  const h = input.headers;
  const isHttps = input.finalUrl.startsWith("https://");

  c.check(isHttps, { id: "https", severity: "high" });

  if (input.httpRedirect) {
    c.check(input.httpRedirect.redirectsToHttps, { id: "http-redirect", severity: "high" });
  }

  if (isHttps) {
    const hsts = h["strict-transport-security"];
    if (!hsts) {
      c.fail({ id: "hsts", key: "hsts.missing", severity: "medium" });
    } else {
      const age = Number(/max-age\s*=\s*"?(\d+)/i.exec(hsts)?.[1] ?? 0);
      c.check(age >= HSTS_MIN_SECONDS, { id: "hsts", key: "hsts.short", severity: "low", params: { seconds: age } });
    }
  }

  const csp = h["content-security-policy"];
  c.check(Boolean(csp), { id: "csp", severity: "medium" });

  c.check((h["x-content-type-options"] ?? "").toLowerCase() === "nosniff", { id: "xcto", severity: "low" });

  const framing = Boolean(h["x-frame-options"]) || /frame-ancestors/i.test(csp ?? "");
  c.check(framing, { id: "framing", severity: "medium" });

  c.check(Boolean(h["referrer-policy"]), { id: "referrer-policy", severity: "low" });

  c.check(Boolean(h["permissions-policy"]), { id: "permissions-policy", severity: "low" });

  if (isHttps) {
    const mixed = doc.tags.filter((t) => {
      const url = t.attrs["src"] ?? (t.name === "link" ? t.attrs["href"] : undefined);
      if (!url || !/^http:\/\//i.test(url)) return false;
      return ["script", "img", "iframe", "source", "audio", "video", "link"].includes(t.name) &&
        (t.name !== "link" || /stylesheet/i.test(t.attrs["rel"] ?? ""));
    });
    c.check(mixed.length === 0, { id: "mixed-content", severity: "high", params: { count: mixed.length } });
  }

  // Cookies from this one response. Cookies set by scripts or on other pages are not visible here.
  const cookies = input.setCookies.map(parseCookie);
  c.fact("cookiesCount", { count: cookies.length });
  if (cookies.length > 0) {
    const noSecure = cookies.filter((k) => !k.secure).length;
    const noHttpOnly = cookies.filter((k) => !k.httpOnly).length;
    const noSameSite = cookies.filter((k) => !k.sameSite).length;
    if (isHttps) {
      if (noSecure > 0) c.fail({ id: "cookies-secure", severity: "medium", params: { count: noSecure, total: cookies.length } });
    }
    if (noHttpOnly > 0) c.fail({ id: "cookies-httponly", severity: "low", params: { count: noHttpOnly, total: cookies.length } });
    if (noSameSite > 0) c.fail({ id: "cookies-samesite", severity: "low", params: { count: noSameSite, total: cookies.length } });
    // One passed entry when every flag is set.
    if ((isHttps ? noSecure : 0) + noHttpOnly + noSameSite === 0) c.pass("cookies");
  }

  if (input.securityTxt !== null) {
    c.check(input.securityTxt, { id: "security-txt", severity: "low" });
  }
  return c.result();
}

interface CookieFlags {
  secure: boolean;
  httpOnly: boolean;
  sameSite: boolean;
}

function parseCookie(header: string): CookieFlags {
  const attrs = header.split(";").slice(1).map((a) => a.trim().toLowerCase());
  return {
    secure: attrs.includes("secure"),
    httpOnly: attrs.includes("httponly"),
    sameSite: attrs.some((a) => a.startsWith("samesite=")),
  };
}
