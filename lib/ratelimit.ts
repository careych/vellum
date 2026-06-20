// Simple in-memory sliding-window rate limiter.
//
// LIMITATION: Vercel serverless functions are stateless; this Map does not
// persist across separate invocations. It only throttles rapid bursts within
// the same warm function container. For production rate limiting across all
// instances, replace with Upstash Redis (@upstash/ratelimit).
//
// This is intentionally lightweight — all write endpoints already require
// an authenticated admin session, so rate limiting is defence-in-depth
// rather than the primary protection layer.

const store = new Map<string, { count: number; resetAt: number }>()

/**
 * Returns true if the request is within the allowed rate, false if it should
 * be rejected (429 Too Many Requests).
 *
 * @param key     Identifies the rate-limit bucket (e.g. "presign:<ip>").
 * @param limit   Maximum number of requests allowed in the window.
 * @param windowMs Window size in milliseconds.
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (entry.count >= limit) return false
  entry.count++
  return true
}

/** Extract the client IP from the X-Forwarded-For header (Vercel sets this). */
export function getClientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
}
