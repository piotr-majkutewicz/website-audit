/**
 * Target validation (SSRF protection). Pure functions, no network access.
 *
 * Limits: a Worker cannot resolve DNS before fetching, so a public hostname that
 * resolves to a private address cannot be detected here. In practice Cloudflare
 * Workers cannot reach private networks anyway. See the README for details.
 */
import type { ErrorKey } from "./i18n/types";

/** On failure, `reason` is a key into the error texts in src/i18n. */
export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: ErrorKey };

const ALLOWED_PORTS = new Set(["", "80", "443"]);

const INTERNAL_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".localdomain",
  ".lan",
  ".home",
  ".home.arpa",
  ".intranet",
  ".corp",
  ".private",
];

/** Adds https:// when the user typed a bare domain such as "example.com". */
export function normalizeInput(raw: string): string {
  const s = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  return "https://" + s;
}

export function validateTarget(raw: string): UrlCheck {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
    return { ok: false, reason: "address_empty_or_long" };
  }
  let url: URL;
  try {
    url = new URL(normalizeInput(raw));
  } catch {
    return { ok: false, reason: "address_invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "scheme_not_allowed" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "credentials_not_allowed" };
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    return { ok: false, reason: "port_not_allowed" };
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "no_host" };

  if (host.startsWith("[")) {
    const v6 = parseIPv6(host.slice(1, -1));
    if (!v6) return { ok: false, reason: "ipv6_invalid" };
    if (!isPublicIPv6(v6)) {
      return { ok: false, reason: "ipv6_not_public" };
    }
    return { ok: true, url };
  }

  const v4 = parseIPv4(host);
  if (v4) {
    if (!isPublicIPv4(v4)) {
      return { ok: false, reason: "ip_not_public" };
    }
    return { ok: true, url };
  }
  // Anything that still looks numeric (for example "1.2.3") is not a real hostname.
  if (/^[0-9.]+$/.test(host)) {
    return { ok: false, reason: "ip_invalid" };
  }

  if (host === "localhost" || !host.includes(".")) {
    return { ok: false, reason: "host_internal" };
  }
  if (INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: "host_internal" };
  }
  return { ok: true, url };
}

export function parseIPv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return parts;
}

export function isPublicIPv4(p: number[]): boolean {
  const [a, b, c] = p as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false; // documentation
  if (a === 192 && b === 88 && c === 99) return false; // deprecated 6to4 relay anycast
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // documentation
  if (a === 203 && b === 0 && c === 113) return false; // documentation
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/** Returns 8 groups of 16 bits, or null when the text is not valid IPv6. */
export function parseIPv6(text: string): number[] | null {
  let s = text;
  // Embedded IPv4 tail such as ::ffff:1.2.3.4
  const tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (tail) {
    const v4 = parseIPv4(tail[1]!);
    if (!v4) return null;
    const hi = ((v4[0]! << 8) | v4[1]!).toString(16);
    const lo = ((v4[2]! << 8) | v4[3]!).toString(16);
    s = s.slice(0, -tail[1]!.length) + hi + ":" + lo;
  }
  const dbl = s.split("::");
  if (dbl.length > 2) return null;
  const toGroups = (part: string) => (part === "" ? [] : part.split(":"));
  const head = toGroups(dbl[0]!);
  const rest = dbl.length === 2 ? toGroups(dbl[1]!) : [];
  let groups: string[];
  if (dbl.length === 2) {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<string>(missing).fill("0"), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

/** Only global unicast (2000::/3) is allowed, minus documentation and 6to4 ranges. */
export function isPublicIPv6(g: number[]): boolean {
  const first = g[0]!;
  if ((first & 0xe000) !== 0x2000) return false; // loopback, ULA, link-local, mapped IPv4, etc.
  if (first === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (first === 0x2002) return false; // 6to4 embeds IPv4 addresses
  if (first === 0x2001 && g[1]! < 0x200) return false; // 2001::/23 protocol assignments (Teredo, ORCHID, benchmarking)
  if (first === 0x3fff && (g[1]! & 0xf000) === 0) return false; // 3fff::/20 documentation
  return true;
}
