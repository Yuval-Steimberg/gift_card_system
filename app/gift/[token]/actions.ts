'use server'

import { getStore } from '@/lib/data'

/**
 * Recipient reports the card lost/compromised. We DON'T auto-void from a public
 * page (abuse risk); we record an audit entry + operational alert so staff can
 * verify identity and reissue. Returns a friendly acknowledgement.
 */
export async function reportGiftCardLost(token: string, note: string): Promise<{ ok: boolean }> {
  const store = getStore()
  const card = await store.getGiftCardByToken(token)
  if (!card) return { ok: false }
  await store.appendAudit({
    actorId: null,
    actorRole: 'recipient',
    action: 'giftcard.reported_lost',
    entityType: 'gift_card',
    entityId: card.id,
    reason: note.slice(0, 300),
    metadata: { channel: 'public_page' },
  })
  return { ok: true }
}
