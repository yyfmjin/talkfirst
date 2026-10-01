import type { Request } from "express";

/**
 * Security Audit Center (P1) — the single source of a client IP.
 *
 * ## Trusted-proxy assumption
 *
 * TalkFirst is deployed behind HTTPS with Cloudflare in front of a reverse
 * proxy, so the socket peer is *not* the client. Express is configured with
 * `app.set("trust proxy", trustProxySetting())` (see `main.ts`), which makes
 * `req.ip` the left-most address that is not covered by the trusted hop count.
 *
 * We read **only** `req.ip` and never `X-Forwarded-For` / `X-Real-IP` directly.
 * Those headers are attacker-controlled unless the proxy overwrites them, and a
 * forged value would poison IP-based investigation. Letting Express do the hop
 * arithmetic is what makes the result trustworthy.
 *
 * `TRUST_PROXY` overrides the assumption for other topologies:
 *   - a number N  -> trust N hops from the app (default `1` in production)
 *   - `true` / `false` -> trust everything / nothing (dev)
 * Anything unparseable falls back to `false` — never to "trust everything".
 */
export function trustProxySetting(): number | boolean {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw) return process.env.NODE_ENV === "production" ? 1 : false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  const hops = Number(raw);
  return Number.isInteger(hops) && hops >= 0 ? hops : false;
}

/** Strips an IPv4 port or an IPv4-mapped IPv6 prefix, and caps the length. */
export function normalizeIp(raw: string): string {
  let ip = raw.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) ip = mapped[1];
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(ip);
  if (withPort) ip = withPort[1];
  return ip.slice(0, 45);
}

/** The client IP as resolved by Express' trusted-proxy handling. */
export function getClientIp(request: Request): string | undefined {
  const raw = request.ip;
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  return normalizeIp(raw);
}
