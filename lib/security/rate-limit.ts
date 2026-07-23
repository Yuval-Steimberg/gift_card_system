/**
 * Simple in-memory fixed-window rate limiter for public lookups (gift-card
 * code validation, token lookups). For a single-instance deployment this is
 * sufficient; a multi-instance production deployment should back this with
 * Redis/Upstash (the interface is intentionally trivial to swap).
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const existing = buckets.get(key)
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs
    buckets.set(key, { count: 1, resetAt })
    return { allowed: true, remaining: limit - 1, resetAt }
  }
  existing.count += 1
  const allowed = existing.count <= limit
  return { allowed, remaining: Math.max(0, limit - existing.count), resetAt: existing.resetAt }
}

/** Derive a best-effort client key from request headers. */
export function clientKeyFromHeaders(headers: Headers, salt = ''): string {
  const ip =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  return `${salt}:${ip}`
}

/** Test/maintenance helper. */
export function _resetRateLimits(): void {
  buckets.clear()
}
