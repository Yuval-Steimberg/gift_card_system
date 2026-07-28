/**
 * Server-only: does the domain actually accept mail? Checks MX, then falls back
 * to A/AAAA (many small domains receive mail without an explicit MX). Fail-OPEN
 * on transient DNS errors so a real customer is never blocked by a hiccup —
 * only a definitively non-existent domain (no MX and no address) is rejected.
 *
 * Kept in its own module (separate from `email.ts`) because it imports
 * `node:dns` — the client purchase wizard imports the syntax/typo helpers from
 * `email.ts`, and webpack would fail to bundle `node:dns` for the browser.
 */
export async function domainCanReceiveMail(email: string): Promise<boolean> {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return false
  try {
    const dns = await import('node:dns/promises')
    try {
      const mx = await dns.resolveMx(domain)
      if (mx && mx.length > 0) return true
    } catch {
      /* fall through to address lookup */
    }
    try {
      const addrs = await dns.lookup(domain, { all: true })
      return Array.isArray(addrs) && addrs.length > 0
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code
      // Definitive "doesn't exist" → reject. Anything else (timeout, etc.) → allow.
      return !(code === 'ENOTFOUND' || code === 'ENODATA')
    }
  } catch {
    return true // dns module unavailable → don't block
  }
}
