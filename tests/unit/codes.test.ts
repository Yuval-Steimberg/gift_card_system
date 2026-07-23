import { describe, it, expect } from 'vitest'
import {
  generateGiftCardCode,
  isValidGiftCardCode,
  normalizeGiftCardCode,
  generatePublicToken,
} from '@/lib/gift-cards/codes'

describe('gift card codes', () => {
  it('generates valid, checksum-protected codes', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateGiftCardCode()
      expect(code).toMatch(/^JAS-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]$/)
      expect(isValidGiftCardCode(code)).toBe(true)
    }
  })

  it('rejects codes with a broken checksum', () => {
    const code = generateGiftCardCode()
    // Flip the check character to something else.
    const bad = code.slice(0, -1) + (code.endsWith('0') ? '1' : '0')
    expect(isValidGiftCardCode(bad)).toBe(false)
  })

  it('normalizes ambiguous characters and casing', () => {
    const code = generateGiftCardCode()
    const messy = code.toLowerCase().replace(/-/g, ' ')
    expect(normalizeGiftCardCode(messy)).toBe(code)
  })

  it('produces long, unique, url-safe tokens', () => {
    const a = generatePublicToken()
    const b = generatePublicToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(43)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
