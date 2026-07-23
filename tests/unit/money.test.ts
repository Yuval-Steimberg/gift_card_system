import { describe, it, expect } from 'vitest'
import { toMinor, toMajor, parseMajorToMinor, formatMoney, isValidMinor, assertPositiveMinor } from '@/lib/money'

describe('money (integer minor units)', () => {
  it('converts major to minor without float drift', () => {
    expect(toMinor(100)).toBe(10000)
    expect(toMinor(249.9)).toBe(24990)
    expect(toMinor(0.01)).toBe(1)
    expect(toMinor(1999.99)).toBe(199999)
  })

  it('round-trips minor <-> major', () => {
    expect(toMajor(24990)).toBe(249.9)
    expect(toMajor(10000)).toBe(100)
  })

  it('parses user strings including symbols and separators', () => {
    expect(parseMajorToMinor('₪1,000')).toBe(100000)
    expect(parseMajorToMinor('249.90')).toBe(24990)
    expect(parseMajorToMinor('abc')).toBeNull()
    expect(parseMajorToMinor('')).toBeNull()
  })

  it('formats with currency symbol and he-IL grouping', () => {
    expect(formatMoney(10000)).toBe('₪100')
    expect(formatMoney(24990)).toBe('₪249.90')
    expect(formatMoney(100000)).toBe('₪1,000')
  })

  it('validates minor amounts', () => {
    expect(isValidMinor(100)).toBe(true)
    expect(isValidMinor(-1)).toBe(false)
    expect(isValidMinor(1.5)).toBe(false)
    expect(() => assertPositiveMinor(0)).toThrow()
    expect(() => assertPositiveMinor(-5)).toThrow()
    expect(() => assertPositiveMinor(100)).not.toThrow()
  })
})
