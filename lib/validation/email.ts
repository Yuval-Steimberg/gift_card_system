/**
 * Strict, dependency-free email validation shared by the client (instant UX) and
 * the server (source of truth). Two synchronous layers here:
 *  1. syntax   — real structure, no spaces, valid TLD, no double dots, etc.
 *  2. typos    — catches misspellings of popular providers (gmial.com → gmail.com).
 * The third layer — (server only, async) verifying the domain actually has an
 * MX/A record — lives in `email-deliverability.ts` so `node:dns` never reaches
 * the client bundle (this file is imported by the client purchase wizard).
 */

// Local part: letters/digits and . _ % + - ' ; no leading/trailing/double dot.
const LOCAL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/
// Domain label: letters/digits/hyphen, no leading/trailing hyphen.
const LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/
// TLD: 2–24 letters (no all-digit TLDs).
const TLD_RE = /^[A-Za-z]{2,24}$/

/** Popular mail domains — used for typo suggestions. */
const POPULAR_DOMAINS = [
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.co.il', 'outlook.com', 'outlook.co.il',
  'live.com', 'yahoo.com', 'yahoo.co.il', 'ymail.com', 'icloud.com', 'me.com', 'proton.me',
  'protonmail.com', 'walla.com', 'walla.co.il', 'zahav.net.il', 'nana.co.il', '012.net.il',
]

/** Curated common misspellings → the intended domain (hard-blocked with a hint). */
const KNOWN_TYPOS: Record<string, string> = {
  'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.om': 'gmail.com',
  'gmail.comm': 'gmail.com', 'gmai.com': 'gmail.com', 'gmial.com': 'gmail.com', 'gmil.com': 'gmail.com',
  'gmaill.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.co.il': 'gmail.com', 'gmailc.om': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmail.con': 'hotmail.com',
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yhaoo.com': 'yahoo.com',
  'outlok.com': 'outlook.com', 'outook.com': 'outlook.com', 'outlook.con': 'outlook.com',
  'iclould.com': 'icloud.com', 'icloud.co': 'icloud.com', 'iclod.com': 'icloud.com',
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) d[0]![j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
    }
  }
  return d[m]![n]!
}

export interface EmailCheck {
  ok: boolean
  /** Hebrew error message when invalid. */
  error?: string
  /** A suggested corrected address when a likely typo is detected. */
  suggestion?: string
}

/** Synchronous validation: syntax + typo detection. No network. */
export function checkEmail(raw: string): EmailCheck {
  const email = raw.trim()
  if (!email) return { ok: false, error: 'נא להזין כתובת אימייל' }
  if (/\s/.test(email)) return { ok: false, error: 'כתובת האימייל מכילה רווח' }
  if (email.length > 254) return { ok: false, error: 'כתובת האימייל ארוכה מדי' }

  const at = email.split('@')
  if (at.length !== 2) return { ok: false, error: 'כתובת אימייל חייבת לכלול @ אחד' }
  const [local, domain] = at as [string, string]

  if (!local || local.length > 64 || !LOCAL_RE.test(local)) {
    return { ok: false, error: 'החלק שלפני ה-@ אינו תקין' }
  }
  const labels = domain.toLowerCase().split('.')
  if (labels.length < 2 || domain.includes('..') || !labels.every((l) => LABEL_RE.test(l))) {
    return { ok: false, error: 'שם הדומיין (אחרי ה-@) אינו תקין' }
  }
  const tld = labels[labels.length - 1]!
  if (!TLD_RE.test(tld)) return { ok: false, error: 'סיומת הדומיין אינה תקינה' }

  const dom = domain.toLowerCase()
  // Hard-known typo → block with the correction.
  if (KNOWN_TYPOS[dom]) {
    return { ok: false, error: `האם התכוונת ל-${local}@${KNOWN_TYPOS[dom]}?`, suggestion: `${local}@${KNOWN_TYPOS[dom]}` }
  }
  // Close-but-not-exact to a popular domain (edit distance 1) → likely typo.
  if (!POPULAR_DOMAINS.includes(dom)) {
    const near = POPULAR_DOMAINS.find((d) => levenshtein(dom, d) === 1)
    if (near) {
      return { ok: false, error: `האם התכוונת ל-${local}@${near}?`, suggestion: `${local}@${near}` }
    }
  }
  return { ok: true }
}

/** True when the email passes synchronous (syntax + typo) validation. */
export function isValidEmail(raw: string): boolean {
  return checkEmail(raw).ok
}
