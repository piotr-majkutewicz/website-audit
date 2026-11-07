import type { ParsedHtml } from "../html";
import type { AuditInput, CheckOutcome } from "../types";
import { Collector } from "./helpers";

const HSTS_MIN_SECONDS = 15_552_000; // 180 days

export function checkSecurity(input: AuditInput, doc: ParsedHtml): CheckOutcome {
  const c = new Collector("security");
  const h = input.headers;
  const isHttps = input.finalUrl.startsWith("https://");

  c.check(isHttps, "The page is served over HTTPS", {
    id: "https",
    severity: "high",
    title: "The page is not served over HTTPS",
    why: "Without HTTPS, anyone on the network path can read or change what visitors send and receive. Browsers label such pages as not secure, which hurts trust and search ranking.",
    fix: "Install a TLS certificate (most hosts offer a free one) and serve the whole site over HTTPS.",
  });

  if (input.httpRedirect) {
    c.check(input.httpRedirect.redirectsToHttps, "http:// redirects to https://", {
      id: "http-redirect",
      severity: "high",
      title: "The http:// version does not redirect to https://",
      why: "Visitors who type or follow an old http link stay on an unencrypted page, and search engines may index two versions of the site.",
      fix: "Add a permanent (301) redirect from http:// to https:// in your hosting or CDN settings.",
    });
  }

  if (isHttps) {
    const hsts = h["strict-transport-security"];
    if (!hsts) {
      c.fail({
        id: "hsts",
        severity: "medium",
        title: "Missing Strict-Transport-Security (HSTS) header",
        why: "HSTS tells browsers to always use HTTPS for your site, which blocks downgrade attacks and removes the insecure first redirect.",
        fix: "Send Strict-Transport-Security: max-age=31536000; includeSubDomains once you are sure the whole site works over HTTPS.",
      });
    } else {
      const age = Number(/max-age\s*=\s*"?(\d+)/i.exec(hsts)?.[1] ?? 0);
      c.check(age >= HSTS_MIN_SECONDS, "HSTS is set with a long max-age", {
        id: "hsts",
        severity: "low",
        title: "HSTS max-age is short",
        why: "A short HSTS lifetime gives only brief protection after each visit.",
        fix: "Raise max-age to at least 15552000 seconds (180 days), ideally 31536000.",
        detail: `max-age=${age}`,
      });
    }
  }

  const csp = h["content-security-policy"];
  c.check(Boolean(csp), "Content-Security-Policy is set", {
    id: "csp",
    severity: "medium",
    title: "Missing Content-Security-Policy header",
    why: "CSP limits which scripts and resources a page may load, which greatly reduces the damage of injected scripts (XSS).",
    fix: "Start with a report-only policy, then enforce one that lists only the sources you actually use.",
  });

  c.check((h["x-content-type-options"] ?? "").toLowerCase() === "nosniff", "X-Content-Type-Options is nosniff", {
    id: "xcto",
    severity: "low",
    title: "Missing X-Content-Type-Options: nosniff",
    why: "Without it, some browsers guess file types and may run an uploaded file as a script.",
    fix: "Send the header X-Content-Type-Options: nosniff on all responses.",
  });

  const framing = Boolean(h["x-frame-options"]) || /frame-ancestors/i.test(csp ?? "");
  c.check(framing, "Clickjacking protection is set", {
    id: "framing",
    severity: "medium",
    title: "No protection against embedding in other sites (clickjacking)",
    why: "Another site can embed your page in a hidden frame and trick visitors into clicking things on it.",
    fix: "Send X-Frame-Options: SAMEORIGIN or a Content-Security-Policy with frame-ancestors 'self'.",
  });

  c.check(Boolean(h["referrer-policy"]), "Referrer-Policy is set", {
    id: "referrer-policy",
    severity: "low",
    title: "Missing Referrer-Policy header",
    why: "Without a policy, full page addresses (which can contain private data) may be passed to other sites.",
    fix: "Send Referrer-Policy: strict-origin-when-cross-origin.",
  });

  c.check(Boolean(h["permissions-policy"]), "Permissions-Policy is set", {
    id: "permissions-policy",
    severity: "low",
    title: "Missing Permissions-Policy header",
    why: "The header lets you switch off browser features (camera, microphone, location) that your site and embedded content do not need.",
    fix: "Send for example Permissions-Policy: camera=(), microphone=(), geolocation=().",
  });

  if (isHttps) {
    const mixed = doc.tags.filter((t) => {
      const url = t.attrs["src"] ?? (t.name === "link" ? t.attrs["href"] : undefined);
      if (!url || !/^http:\/\//i.test(url)) return false;
      return ["script", "img", "iframe", "source", "audio", "video", "link"].includes(t.name) &&
        (t.name !== "link" || /stylesheet/i.test(t.attrs["rel"] ?? ""));
    });
    c.check(mixed.length === 0, "No http:// resources on the HTTPS page", {
      id: "mixed-content",
      severity: "high",
      title: "The HTTPS page loads resources over plain http://",
      why: "Browsers block or warn about such mixed content, so images or scripts may silently fail and the padlock disappears.",
      fix: "Change those links to https:// (or protocol-relative paths on your own domain).",
      detail: `resources: ${mixed.length}`,
    });
  }
  return c.result();
}
