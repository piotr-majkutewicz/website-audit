import { describe, expect, it } from "vitest";
import { normalizeInput, validateTarget } from "../src/ssrf";

const ok = (s: string) => expect(validateTarget(s).ok, s).toBe(true);
const bad = (s: string) => expect(validateTarget(s).ok, s).toBe(false);

describe("validateTarget", () => {
  it("accepts ordinary public addresses", () => {
    ok("https://example.com");
    ok("http://example.com/path?q=1");
    ok("example.com");
    ok("https://example.com:443/");
    ok("http://example.com:80/");
    ok("https://sub.domain.example.co.uk/");
    ok("https://93.184.216.34/");
    ok("https://[2606:2800:220:1:248:1893:25c8:1946]/");
  });

  it("rejects other schemes", () => {
    bad("ftp://example.com");
    bad("file:///etc/passwd");
    bad("javascript:alert(1)");
    bad("data:text/html,hi");
    bad("gopher://example.com");
  });

  it("rejects localhost and internal names", () => {
    bad("http://localhost");
    bad("http://LOCALHOST/");
    bad("http://foo.localhost");
    bad("http://printer.local");
    bad("http://db.internal");
    bad("http://intranet");
    bad("http://router.lan");
    bad("http://nas.home.arpa");
  });

  it("rejects private, loopback and link-local IPv4", () => {
    for (const ip of [
      "127.0.0.1", "127.255.255.254", "10.0.0.1", "172.16.0.1", "172.31.255.255",
      "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255",
    ]) bad(`http://${ip}/`);
    ok("http://172.15.0.1/");
    ok("http://172.32.0.1/");
  });

  it("normalizes tricky IPv4 notations through the URL parser", () => {
    bad("http://2130706433/"); // decimal 127.0.0.1
    bad("http://0x7f000001/"); // hex
    bad("http://0177.0.0.1/"); // octal
    bad("http://127.1/"); // short form
    bad("http://017700000001/");
    bad("http://127.0.0.1./");
  });

  it("rejects non-public IPv6 literals", () => {
    bad("http://[::1]/");
    bad("http://[::]/");
    bad("http://[fe80::1]/");
    bad("http://[fc00::1]/");
    bad("http://[fd12:3456::1]/");
    bad("http://[::ffff:127.0.0.1]/");
    bad("http://[::ffff:7f00:1]/");
    bad("http://[2001:db8::1]/");
    bad("http://[2002:7f00:1::]/");
  });

  it("rejects unusual ports", () => {
    bad("http://example.com:8080/");
    bad("https://example.com:22/");
    bad("http://example.com:6379/");
  });

  it("rejects credentials in the URL and bad input", () => {
    bad("http://user:pass@example.com/");
    bad("http://admin@example.com/");
    bad("");
    bad("   ");
    bad("http://");
    bad("https://exa mple.com");
    bad("https://" + "a".repeat(3000) + ".com");
  });

  it("rejects hostnames that only look like a public site", () => {
    bad("http://127.0.0.1.:80/");
    bad("http://10.1/"); // normalized to 10.0.0.1
  });
});

describe("normalizeInput", () => {
  it("adds https:// to bare domains only", () => {
    expect(normalizeInput(" example.com ")).toBe("https://example.com");
    expect(normalizeInput("http://example.com")).toBe("http://example.com");
  });

  it("rejects more reserved ranges and IPv6 forms", () => {
    bad("http://192.88.99.1/");
    bad("http://[2001::1]/");
    bad("http://[2001:10::1]/");
    bad("http://[3fff::1]/");
    bad("http://[::ffff:127.0.0.1]/");
    bad("http://[::ffff:7f00:1]/");
    bad("http://[64:ff9b::7f00:1]/"); // NAT64 can map to private IPv4
    bad("http://[0:0:0:0:0:0:0:1]/");
    bad("http://localhost./");
    bad("http://foo.internal./");
    bad("http://user:pass@example.com/");
    bad("http://example.com:8080/");
    bad("http://example.com:0/");
    ok("https://[2a00:1450:4001:81b::200e]/");
  });
});
