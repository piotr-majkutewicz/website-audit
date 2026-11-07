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
  return c.result();
}
