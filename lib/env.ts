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
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
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

  EMAIL_PROVIDER: z.enum(['log', 'resend']).default('log'),
  EMAIL_FROM: z.string().default('Just A Second <gifts@example.com>'),
  RESEND_API_KEY: z.string().optional(),

  RECEIPT_PROVIDER: z.enum(['mock', 'greeninvoice']).default('mock'),
  GREENINVOICE_API_KEY: z.string().optional(),
  GREENINVOICE_API_SECRET: z.string().optional(),

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

  // Cross-field production guards: real providers require their credentials.
  const problems: string[] = []
  if (env.NEXT_PUBLIC_SUPABASE_URL && !env.SUPABASE_SERVICE_ROLE_KEY) {
    problems.push(
      'SUPABASE_SERVICE_ROLE_KEY is required when NEXT_PUBLIC_SUPABASE_URL is set ' +
        '(the server must not fall back to the anon key for privileged writes).',
    )
  }
  if (env.PAYMENT_PROVIDER === 'grow' && (!env.GROW_API_KEY || !env.GROW_API_SECRET)) {
    problems.push('GROW_API_KEY and GROW_API_SECRET are required when PAYMENT_PROVIDER=grow.')
  }
  if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
    problems.push('RESEND_API_KEY is required when EMAIL_PROVIDER=resend.')
  }
  if (env.RECEIPT_PROVIDER === 'greeninvoice' && !env.GREENINVOICE_API_KEY) {
    problems.push('GREENINVOICE_API_KEY is required when RECEIPT_PROVIDER=greeninvoice.')
  }
  if (
    env.NODE_ENV === 'production' &&
    env.PAYMENT_PROVIDER !== 'mock' &&
    env.PAYMENT_WEBHOOK_SECRET === 'dev-payment-webhook-secret-change-me'
  ) {
    problems.push(
      'PAYMENT_WEBHOOK_SECRET must be changed from its dev default when a real payment provider is enabled.',
    )
  }
  if (problems.length > 0) {
    throw new Error(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  }

  cached = env
  return env
}

/** True when a real Supabase project is configured (else in-memory store). */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}
