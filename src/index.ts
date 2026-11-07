import { analyzeNeutral, localize } from "./audit";
import { AuditError, collect } from "./fetcher";
import { DEFAULT_LANG, dictionary, isLang, type ErrorKey, type Lang } from "./i18n";
import { validateTarget } from "./ssrf";
import { runPagespeed } from "./pagespeed";
import { renderUi } from "./ui";

export interface Env {
  /** Optional: the binding is missing in some local setups and the code copes with that. */
  RATE_LIMITER?: RateLimit;
  /** Optional secret. When set, the page also offers a measurement by Google PageSpeed Insights. */
  PAGESPEED_API_KEY?: string;
}

const MAX_BODY_BYTES = 2048;

const BASE_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "strict-transport-security": "max-age=31536000",
  // The public demo must not be indexed. Crawlers can only see this if robots.txt allows crawling.
  "x-robots-tag": "noindex, nofollow",
};

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...BASE_HEADERS, ...extra },
  });
}

/** Error responses: a stable code plus a message in the requested language. */
function apiError(status: number, code: string, key: ErrorKey, lang: Lang, extra: Record<string, string> = {}): Response {
  return json({ error: { code, key, message: dictionary(lang).errors[key] } }, status, extra);
}

/** Language from the ?lang= query parameter. Missing or unknown values give null. */
function queryLang(url: URL): Lang | null {
  const v = url.searchParams.get("lang");
  return isLang(v) ? v : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch {
      // Never leak internals: nothing about the failure is sent to the client.
      return apiError(500, "internal_error", "internal_error", DEFAULT_LANG);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    return new Response(request.method === "HEAD" ? null : renderUi(nonce, queryLang(url) ?? DEFAULT_LANG), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        ...BASE_HEADERS,
      },
    });
  }

  // Crawling stays allowed on purpose, otherwise search engines could not read the noindex signal.
  if (url.pathname === "/robots.txt" && (request.method === "GET" || request.method === "HEAD")) {
    return new Response(request.method === "HEAD" ? null : "User-agent: *\nAllow: /\n", {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...BASE_HEADERS },
    });
  }

  if (url.pathname === "/api/audit") {
    if (request.method !== "POST") {
      return apiError(405, "method_not_allowed", "method_not_allowed", queryLang(url) ?? DEFAULT_LANG, { allow: "POST" });
    }
    return handleAudit(request, env, queryLang(url) ?? DEFAULT_LANG);
  }

  // Hidden (404) unless the PageSpeed key is configured.
  if (url.pathname === "/api/pagespeed" && env.PAGESPEED_API_KEY) {
    if (request.method !== "POST") {
      return apiError(405, "method_not_allowed", "method_not_allowed", queryLang(url) ?? DEFAULT_LANG, { allow: "POST" });
    }
    return handlePagespeed(request, env, queryLang(url) ?? DEFAULT_LANG);
  }

  return apiError(404, "not_found", "not_found", queryLang(url) ?? DEFAULT_LANG);
}

async function handleAudit(request: Request, env: Env, queryLanguage: Lang): Promise<Response> {
  // Until the body is parsed, errors use the language from the query string (default: Polish).
  let lang = queryLanguage;

  // Rate limit first, before any expensive work. Skipped when the binding is not available.
  if (env.RATE_LIMITER) {
    const key = request.headers.get("cf-connecting-ip") ?? "anonymous";
    const { success } = await env.RATE_LIMITER.limit({ key });
    if (!success) {
      return apiError(429, "rate_limited", "rate_limited", lang, { "retry-after": "60" });
    }
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return apiError(413, "body_too_large", "body_too_large", lang);
  let text: string;
  try {
    text = await request.text();
  } catch {
    return apiError(400, "invalid_body", "body_unreadable", lang);
  }
  if (text.length > MAX_BODY_BYTES) return apiError(413, "body_too_large", "body_too_large", lang);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return apiError(400, "invalid_json", "invalid_json", lang);
  }
  const fields = (body ?? {}) as { url?: unknown; lang?: unknown };

  // The "lang" field in the body wins over ?lang=. An unknown value is rejected, not guessed.
  if (fields.lang !== undefined && fields.lang !== null) {
    if (!isLang(fields.lang)) return apiError(400, "invalid_lang", "invalid_lang", lang);
    lang = fields.lang;
  }

  const raw = fields.url;
  if (typeof raw !== "string") return apiError(400, "invalid_url", "url_missing", lang);

  const check = validateTarget(raw);
  if (!check.ok) return apiError(400, "blocked_target", check.reason, lang);

  try {
    const input = await collect(check.url.toString(), (u, init) => fetch(u, init));
    return json(localize(analyzeNeutral(input, new Date(), Boolean(env.PAGESPEED_API_KEY)), lang));
  } catch (e) {
    if (e instanceof AuditError) {
      const status = e.code === "blocked_target" ? 400 : e.code === "timeout" ? 504 : 502; // bad_certificate and the rest: 502
      return apiError(status, e.code, e.messageKey, lang);
    }
    return apiError(500, "internal_error", "internal_error", lang);
  }
}

/** Second, optional stage: Lighthouse numbers from Google for the address that was audited. */
async function handlePagespeed(request: Request, env: Env, queryLanguage: Lang): Promise<Response> {
  const lang = queryLanguage;
  if (env.RATE_LIMITER) {
    // Counted separately from the audits of the same visitor.
    const key = "pagespeed:" + (request.headers.get("cf-connecting-ip") ?? "anonymous");
    const { success } = await env.RATE_LIMITER.limit({ key });
    if (!success) return apiError(429, "rate_limited", "rate_limited", lang, { "retry-after": "60" });
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return apiError(400, "invalid_body", "body_unreadable", lang);
  }
  if (text.length > MAX_BODY_BYTES) return apiError(413, "body_too_large", "body_too_large", lang);
  let body: { url?: unknown };
  try {
    body = (JSON.parse(text) ?? {}) as { url?: unknown };
  } catch {
    return apiError(400, "invalid_json", "invalid_json", lang);
  }
  if (typeof body.url !== "string") return apiError(400, "invalid_url", "url_missing", lang);
  const check = validateTarget(body.url);
  if (!check.ok) return apiError(400, "blocked_target", check.reason, lang);

  const outcome = await runPagespeed(check.url.toString(), env.PAGESPEED_API_KEY!);
  if (!outcome.ok) return apiError(outcome.status, outcome.key, outcome.key, lang);
  return json({ pagespeed: outcome.result });
}
