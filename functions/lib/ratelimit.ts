import type { KvStore } from "./store";
import { sha256Hex, utcDay } from "./crypto";

/** Per-route hourly limits (per salted, daily-rotating IP hash). */
const RATE_LIMITS = { analyze: 10, ask: 30, match: 10 } as const;
type RateLimitedRoute = keyof typeof RATE_LIMITS;

const HOUR_SECONDS = 3600;

/**
 * Hash an IP with a secret salt and the current UTC day. Raw IPs are never stored, and hashes
 * cannot be linked across days.
 */
export async function hashIp(ip: string, salt: string, now: Date = new Date()): Promise<string> {
  return (await sha256Hex(`${salt}|${utcDay(now)}|${ipBucket(ip)}`)).slice(0, 32);
}

/**
 * IPv6 clients usually control a whole /64, so rotating addresses inside it would bypass per-IP
 * limits: bucket IPv6 by its /64 prefix. IPv4 (and unknown values) are used as-is.
 */
export function ipBucket(ip: string): string {
  const v = ip.trim().toLowerCase();
  if (!v.includes(":")) return v;
  const [head, tail = ""] = v.split("::");
  const a = head ? head.split(":") : [];
  const b = tail ? tail.split(":") : [];
  const groups = v.includes("::") ? [...a, ...Array<string>(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b] : a;
  return `${groups.slice(0, 4).map((g) => g.padStart(4, "0")).join(":")}::/64`;
}

interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  /** Seconds until the current window resets. */
  retryAfter: number;
}

/** Fixed one-hour window counter. */
export async function checkRateLimit(store: KvStore, route: RateLimitedRoute, ipHash: string, now: Date = new Date()): Promise<RateLimitResult> {
  const epochSec = Math.floor(now.getTime() / 1000);
  const window = Math.floor(epochSec / HOUR_SECONDS);
  const count = await store.incr(`rl:${route}:${ipHash}:${window}`, HOUR_SECONDS);
  const limit = RATE_LIMITS[route];
  return { allowed: count <= limit, count, limit, retryAfter: (window + 1) * HOUR_SECONDS - epochSec };
}
