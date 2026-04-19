/**
 * SSRF guard for homework extractors that fetch arbitrary user URLs.
 *
 * - Allows only http(s)
 * - Blocks loopback / link-local / private / reserved IP ranges
 * - Blocks bare hostnames (localhost variants)
 * - Resolves DNS A/AAAA and blocks if any address resolves to a blocked range
 */

import dns from "node:dns/promises";
import net from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
]);

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal"];

export interface UrlSafetyResult {
  ok: boolean;
  reason?: string;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
  if (lower.startsWith("ff")) return true; // multicast
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.replace("::ffff:", "");
    if (net.isIPv4(v4)) return isPrivateIPv4(v4);
  }
  return false;
}

export async function assertSafeFetchUrl(rawUrl: string): Promise<UrlSafetyResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: `protocol_blocked:${parsed.protocol}` };
  }

  // URL.hostname keeps brackets around IPv6 literals (e.g. "[::1]");
  // strip them so net.isIPv6 / DNS / lookup table all behave correctly.
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  if (!host) return { ok: false, reason: "empty_host" };
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, reason: `blocked_host:${host}` };
  for (const suf of BLOCKED_HOST_SUFFIXES) {
    if (host === suf.slice(1) || host.endsWith(suf)) {
      return { ok: false, reason: `blocked_suffix:${suf}` };
    }
  }

  // If host is itself a literal IP, check directly.
  if (net.isIPv4(host) && isPrivateIPv4(host)) {
    return { ok: false, reason: `blocked_ipv4:${host}` };
  }
  if (net.isIPv6(host) && isPrivateIPv6(host)) {
    return { ok: false, reason: `blocked_ipv6:${host}` };
  }

  // Otherwise resolve DNS and verify every record is public.
  if (!net.isIP(host)) {
    try {
      const records = await dns.lookup(host, { all: true, verbatim: true });
      for (const r of records) {
        if (r.family === 4 && isPrivateIPv4(r.address)) {
          return { ok: false, reason: `dns_private_ipv4:${r.address}` };
        }
        if (r.family === 6 && isPrivateIPv6(r.address)) {
          return { ok: false, reason: `dns_private_ipv6:${r.address}` };
        }
      }
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, reason: `dns_lookup_failed:${code ?? msg ?? "unknown"}` };
    }
  }

  return { ok: true };
}
