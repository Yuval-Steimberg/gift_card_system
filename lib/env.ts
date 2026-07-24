import { z } from 'zod'

/**
 * Environment-variable validation. Everything is optional so the app runs
 * offline with mock providers; when a provider is switched to a real one we
 * assert its required credentials are present (fail fast, clear message).
 *
 * Server-only secrets are read lazily via `serverEnv()` so they are never
 * evaluated in a client bundle.
 */

const rawServerSchema = z.object({
  // Forgiving AND bulletproof: accepts a bare domain (adds https://), strips all
  // whitespace (incl. accidental internal spaces) + trailing slashes, and validates
  // with `new URL()` so a mistyped value falls back to localhost instead of throwing.
  // serverEnv() runs on hot paths (auth, checkout) and must NEVER throw here.
  APP_BASE_URL: z.preprocess((v) => {
    const fallback = 'http://localhost:3000'
    if (typeof v !== 'string') return fallback
    let s = v.replace(/\s+/g, '').replace(/\/+$/, '')
    if (s === '') return fallback
    if (!/^https?:\/\//i.test(s)) s = `https://${s}`
    try {
      return new URL(s).toString().replace(/\/+$/, '')
    } catch {
      return fallback
    }
  }, z.string()),
  BUSINESS_TIMEZONE: z.string().default('Asia/Jerusalem'),
  CRON_SECRET: z.string().default('dev-cron-secret-change-me'),
  AUTH_SECRET: z.string().default('dev-auth-secret-change-me'),
  // Overrides the demo staff password (used by the offline/demo auth layer).
  // Set this on any publicly-reachable deployment so staff logins aren't 'password'.
  AUTH_DEMO_PASSWORD: z.string().optional(),

  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  PAYMENT_PROVIDER: z.enum(['mock', 'grow']).default('mock'),
  PAYMENT_WEBHOOK_SECRET: z.string().default('dev-payment-webhook-secret-change-me'),
  GROW_API_URL: z.string().optional(),
  GROW_API_KEY: z.string().optional(),
  GROW_API_SECRET: z.string().optional(),
  GROW_PAGE_CODE: z.string().optional(),
  // Optional Make.com webhook (Grow-via-Make), same as the JAS website. When
  // set, checkout goes through the Make scenario; otherwise the direct Grow API.
  MAKE_WEBHOOK_URL: z.string().optional(),

  EMAIL_PROVIDER: z.enum(['log', 'resend']).default('log'),
  EMAIL_FROM: z.string().default('Just A Second <gifts@example.com>'),
  RESEND_API_KEY: z.string().optional(),

  RECEIPT_PROVIDER: z.enum(['mock', 'greeninvoice']).default('mock'),
  GREENINVOICE_API_URL: z.string().optional(),
  GREENINVOICE_API_KEY: z.string().optional(),
  GREENINVOICE_API_SECRET: z.string().optional(),
  // Green Invoice document type code (accountant-confirmed). Default 320
  // (חשבונית מס/קבלה). 400=receipt, 305=tax invoice, 300=proforma.
  GREENINVOICE_DOC_TYPE: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export type ServerEnv = z.infer<typeof rawServerSchema>

let cached: ServerEnv | null = null

export function serverEnv(): ServerEnv {
  if (cached) return cached
  const parsed = rawServerSchema.safeParse(process.env)
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration:\n${parsed.error.issues
        .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    )
  }
  const env = parsed.data

  // IMPORTANT: serverEnv() only parses the schema (all fields optional with
  // defaults) and MUST NOT throw for a misconfigured provider. It is called on
  // hot paths like auth (session signing) and must not fail because, say, the
  // email provider lacks a key. Provider-credential checks live in each
  // provider factory (getPaymentProvider / getEmailProvider / getReceiptProvider)
  // so they only fire when that provider is actually used.
  cached = env
  return env
}

/** True when a real Supabase project is configured (else in-memory store). */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}
