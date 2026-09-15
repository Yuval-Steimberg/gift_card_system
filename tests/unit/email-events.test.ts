import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, createSign } from 'node:crypto'
import { parseEmailEvents, normalizeMessageId } from '@/lib/delivery/email/events'
import { verifySendGridSignature } from '@/lib/security/sendgrid-signature'

describe('SendGrid event parsing', () => {
  it('reduces sg_message_id to the X-Message-Id the send API returned', () => {
    expect(normalizeMessageId('abc123.filterdrecv-7d9f-1.internal')).toBe('abc123')
    expect(normalizeMessageId('')).toBeNull()
    expect(normalizeMessageId(undefined)).toBeNull()
  })

  it('classifies a hard bounce as rejected and keeps the server reason', () => {
    const [ev] = parseEmailEvents([
      {
        event: 'bounce',
        email: 'yoav@1to1landscape.com',
        timestamp: 1_700_000_000,
        sg_message_id: 'msg1.recv',
        reason: '550 5.7.1 Message rejected by the recipient tenant',
        jobId: 'job-1',
        giftCardId: 'card-1',
      },
    ])
    expect(ev).toMatchObject({
      outcome: 'rejected',
      event: 'bounce',
      jobId: 'job-1',
      giftCardId: 'card-1',
      messageId: 'msg1',
    })
    expect(ev!.reason).toContain('550')
  })

  it('treats blocked / dropped / spamreport as rejected too', () => {
    const events = parseEmailEvents(
      ['blocked', 'dropped', 'spamreport'].map((event) => ({ event, email: 'a@b.com', timestamp: 1 })),
    )
    expect(events.map((e) => e.outcome)).toEqual(['rejected', 'rejected', 'rejected'])
  })

  it('does not treat engagement or queue noise as a delivery outcome', () => {
    const events = parseEmailEvents(
      ['processed', 'open', 'click'].map((event) => ({ event, email: 'a@b.com', timestamp: 1 })),
    )
    expect(events.every((e) => e.outcome === 'ignored')).toBe(true)
  })

  it('survives a payload shape it does not recognise', () => {
    // SendGrid disables a webhook that keeps erroring — never throw.
    expect(parseEmailEvents(null)).toEqual([])
    expect(parseEmailEvents({ not: 'an array' })).toEqual([])
    expect(parseEmailEvents([null, 42, { no: 'event field' }])).toEqual([])
  })
})

describe('SendGrid signature verification', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const publicKeyBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
  const timestamp = String(Math.floor(Date.now() / 1000))
  const rawBody = JSON.stringify([{ event: 'bounce' }])

  const sign = (ts: string, body: string) => {
    const s = createSign('sha256')
    s.update(ts + body)
    s.end()
    return s.sign(privateKey).toString('base64')
  }

  it('accepts a genuine signature', () => {
    const res = verifySendGridSignature({
      publicKeyBase64,
      signatureBase64: sign(timestamp, rawBody),
      timestamp,
      rawBody,
    })
    expect(res.ok).toBe(true)
  })

  it('rejects a tampered body — a forged bounce must not mark a card undelivered', () => {
    const res = verifySendGridSignature({
      publicKeyBase64,
      signatureBase64: sign(timestamp, rawBody),
      timestamp,
      rawBody: JSON.stringify([{ event: 'bounce', email: 'attacker@x.com' }]),
    })
    expect(res).toEqual({ ok: false, reason: 'invalid_signature' })
  })

  it('rejects a replayed payload', () => {
    const old = String(Math.floor(Date.now() / 1000) - 3600)
    const res = verifySendGridSignature({
      publicKeyBase64,
      signatureBase64: sign(old, rawBody),
      timestamp: old,
      rawBody,
    })
    expect(res).toEqual({ ok: false, reason: 'stale_timestamp' })
  })

  it('rejects a request with no signature headers at all', () => {
    const res = verifySendGridSignature({ publicKeyBase64, signatureBase64: null, timestamp: null, rawBody })
    expect(res).toEqual({ ok: false, reason: 'missing_signature_headers' })
  })
})
