import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'
import { getStore } from '@/lib/data'
import { getAdminStats, type AdminStats } from '@/lib/gift-cards/admin-service'
import { LOOKBACK_DAYS } from '@/lib/gift-cards/reconcile'

/**
 * Read-only machine summary for the JAS Command Center.
 *
 * It reuses getAdminStats() and getDeliveryHealth() — the same code the /admin
 * dashboard and the daily reconciliation sweep run — so "a sale", "liability"
 * and "paid but not delivered" keep exactly one definition. It returns COUNTS
 * and agorot only: no codes, tokens, names or email addresses ever leave here.
 */
export interface IntegrationSummary {
  version: 1
  generatedAt: string
  stats: AdminStats
  deliveryHealth: {
    windowDays: number
    unmatchedPayments: number
    unmatchedPaymentsMinor: number
    paidNotActivated: number
    undelivered: number
    undeliveredByStatus: Record<string, number>
  }
}

export async function buildIntegrationSummary(now = new Date()): Promise<IntegrationSummary> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const [stats, health] = await Promise.all([getAdminStats(), getStore().getDeliveryHealth(since)])
  const undeliveredByStatus: Record<string, number> = {}
  for (const u of health.undelivered) undeliveredByStatus[u.deliveryStatus] = (undeliveredByStatus[u.deliveryStatus] ?? 0) + 1
  return {
    version: 1,
    generatedAt: now.toISOString(),
    stats,
    deliveryHealth: {
      windowDays: LOOKBACK_DAYS,
      unmatchedPayments: health.unmatchedPayments.length,
      unmatchedPaymentsMinor: health.unmatchedPayments.reduce((s, p) => s + p.amountMinor, 0),
      paidNotActivated: health.paidNotActivated.length,
      undelivered: health.undelivered.length,
      undeliveredByStatus,
    },
  }
}

/** Minimum key length: a short shared secret is guessable. */
export const MIN_INTEGRATION_KEY_LENGTH = 32

/**
 * `Bearer <INTEGRATION_API_KEY>`, compared in constant time over SHA-256
 * digests (so the comparison does not leak the key's length either).
 * No key configured, or a key that is too short = the endpoint is OFF.
 */
export function integrationKeyOk(authorization: string | null, configuredKey: string | undefined): boolean {
  const key = configuredKey?.trim()
  if (!key || key.length < MIN_INTEGRATION_KEY_LENGTH) return false
  const a = createHash('sha256').update(authorization?.trim() ?? '').digest()
  const b = createHash('sha256').update(`Bearer ${key}`).digest()
  return timingSafeEqual(a, b)
}
