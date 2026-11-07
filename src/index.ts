import { analyze } from "./audit";
import { AuditError, collect } from "./fetcher";
import { validateTarget } from "./ssrf";
import { renderUi } from "./ui";

export interface Env {
  /** Optional: the binding is missing in some local setups and the code copes with that. */
  RATE_LIMITER?: RateLimit;
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

function apiError(status: number, code: string, message: string, extra: Record<string, string> = {}): Response {
  return json({ error: { code, message } }, status, extra);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch {
      // Never leak internals: nothing about the failure is sent to the client.
      return apiError(500, "internal_error", "Something went wrong.");
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    return new Response(request.method === "HEAD" ? null : renderUi(nonce), {
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
      return apiError(405, "method_not_allowed", "Use POST with a JSON body {\"url\": \"...\"}.", { allow: "POST" });
    }
    return handleAudit(request, env);
  }

  return apiError(404, "not_found", "Not found.");
}

async function handleAudit(request: Request, env: Env): Promise<Response> {
  // Rate limit first, before any expensive work. Skipped when the binding is not available.
  if (env.RATE_LIMITER) {
    const key = request.headers.get("cf-connecting-ip") ?? "anonymous";
    const { success } = await env.RATE_LIMITER.limit({ key });
    if (!success) {
      return apiError(429, "rate_limited", "Too many requests. Please wait a minute and try again.", { "retry-after": "60" });
    }
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return apiError(413, "body_too_large", "The request body is too large.");
  let text: string;
  try {
    text = await request.text();
  } catch {
    return apiError(400, "invalid_body", "The request body could not be read.");
  }
  if (text.length > MAX_BODY_BYTES) return apiError(413, "body_too_large", "The request body is too large.");

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return apiError(400, "invalid_json", "The request body must be valid JSON.");
  }
  const raw = (body as { url?: unknown } | null)?.url;
  if (typeof raw !== "string") return apiError(400, "invalid_url", "Provide the address in the \"url\" field.");

  const check = validateTarget(raw);
  if (!check.ok) return apiError(400, "blocked_target", check.reason);

  try {
    const input = await collect(check.url.toString(), (u, init) => fetch(u, init));
    return json(analyze(input));
  } catch (e) {
    if (e instanceof AuditError) {
      const status = e.code === "blocked_target" ? 400 : e.code === "timeout" ? 504 : 502;
      return apiError(status, e.code, e.message);
    }
    return apiError(500, "internal_error", "Something went wrong while auditing this site.");
  }
}
