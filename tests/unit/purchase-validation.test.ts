import { describe, it, expect } from 'vitest'
import { isFullName, purchaseInputSchema } from '@/lib/validation/purchase'

describe('isFullName', () => {
  it('accepts real first + last names (Hebrew and Latin)', () => {
    expect(isFullName('יובל שטיינברג')).toBe(true)
    expect(isFullName('John Doe')).toBe(true)
    expect(isFullName("O'Brien Smith")).toBe(true)
    expect(isFullName('Mary-Jane Watson')).toBe(true)
    expect(isFullName('  אבו  סאלח ')).toBe(true) // collapses whitespace
  })
  it('rejects single words, digits, and symbols', () => {
    expect(isFullName('יובל')).toBe(false) // one word
    expect(isFullName('John')).toBe(false)
    expect(isFullName('John123')).toBe(false)
    expect(isFullName('12 34')).toBe(false)
    expect(isFullName('!!')).toBe(false)
    expect(isFullName('')).toBe(false)
  })
})

const validBase = {
  amountMinor: 100,
  templateId: 'tpl_1',
  buyerName: 'יעל שטיינברג',
  buyerEmail: 'buyer@example.com',
  buyerPhone: '0501234567',
  recipientName: 'יובל שטיינברג',
  recipientEmail: 'recipient@example.com',
  recipientPhone: '0521234567',
  acceptedTerms: true as const,
}

describe('purchaseInputSchema — hardened fields', () => {
  it('accepts a fully valid purchase', () => {
    expect(purchaseInputSchema.safeParse(validBase).success).toBe(true)
  })
  it('rejects a single-word buyer name', () => {
    const r = purchaseInputSchema.safeParse({ ...validBase, buyerName: 'יעל' })
    expect(r.success).toBe(false)
  })
  it('rejects a missing recipient phone (now required)', () => {
    const r = purchaseInputSchema.safeParse({ ...validBase, recipientPhone: '' })
    expect(r.success).toBe(false)
  })
  it('rejects an invalid buyer phone', () => {
    const r = purchaseInputSchema.safeParse({ ...validBase, buyerPhone: '123' })
    expect(r.success).toBe(false)
  })
})
