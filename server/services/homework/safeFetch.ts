/**
 * Redirect-safe fetch wrapper for homework extractors.
 *
 * Standard `fetch(..., { redirect: "follow" })` would let an attacker
 * bypass the SSRF guard by serving a public URL that 30x-redirects to a
 * loopback / private / metadata IP. We perform redirects manually and
 * re-validate every hop with assertSafeFetchUrl.
 */

import { assertSafeFetchUrl } from "./urlSafety";

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  buffer?: Buffer;
  finalUrl?: string;
  reason?: string;
}

export async function safeFetch(
  startUrl: string,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const maxRedirects = opts.maxRedirects ?? 5;

  let currentUrl = startUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const safety = await assertSafeFetchUrl(currentUrl);
    if (!safety.ok) {
      return {
        ok: false,
        status: 0,
        finalUrl: currentUrl,
        reason: `unsafe_url:${safety.reason}`,
      };
    }

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(currentUrl, {
        signal: ctrl.signal,
        redirect: "manual",
        headers: opts.headers,
      });
    } catch (e: unknown) {
      clearTimeout(t);
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, status: 0, finalUrl: currentUrl, reason: `fetch_error:${msg}` };
    }
    clearTimeout(t);

    // Manual redirect handling: 3xx with Location header.
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) {
        return {
          ok: false,
          status: res.status,
          finalUrl: currentUrl,
          reason: "redirect_without_location",
        };
      }
      let next: string;
      try {
        next = new URL(loc, currentUrl).toString();
      } catch {
        return {
          ok: false,
          status: res.status,
          finalUrl: currentUrl,
          reason: "redirect_invalid_location",
        };
      }
      if (hop === maxRedirects) {
        return {
          ok: false,
          status: res.status,
          finalUrl: next,
          reason: "too_many_redirects",
        };
      }
      currentUrl = next;
      continue;
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        finalUrl: currentUrl,
        reason: `http_${res.status}`,
      };
    }

    const ab = await res.arrayBuffer();
    return {
      ok: true,
      status: res.status,
      buffer: Buffer.from(ab),
      finalUrl: currentUrl,
    };
  }

  return { ok: false, status: 0, finalUrl: currentUrl, reason: "redirect_loop" };
}
