import { describe, expect, it } from 'vitest'
import { initialAmountFromParam } from '@/lib/gift-cards/initial-amount'

const settings = {
  presetAmountsMinor: [10000, 20000, 50000],
  minAmountMinor: 5000,
  maxAmountMinor: 200000,
  allowCustomAmount: true,
}

describe('initialAmountFromParam (?amount= on /gift-cards)', () => {
  it('selects a preset amount as a preset', () => {
    expect(initialAmountFromParam('200', settings)).toEqual({ amountMinor: 20000, customAmount: '' })
  })
  it('fills another in-range amount into the custom field', () => {
    expect(initialAmountFromParam('250', settings)).toEqual({ amountMinor: 25000, customAmount: '250' })
  })
  it('ignores amounts out of range, invalid, empty or repeated params beyond the first', () => {
    expect(initialAmountFromParam('10', settings)).toBeNull()
    expect(initialAmountFromParam('999999', settings)).toBeNull()
    expect(initialAmountFromParam('abc', settings)).toBeNull()
    expect(initialAmountFromParam('-200', settings)).toBeNull()
    expect(initialAmountFromParam(undefined, settings)).toBeNull()
    expect(initialAmountFromParam(['100', '500'], settings)).toEqual({ amountMinor: 10000, customAmount: '' })
  })
  it('keeps custom amounts off when the store disables them', () => {
    const presetsOnly = { ...settings, allowCustomAmount: false }
    expect(initialAmountFromParam('250', presetsOnly)).toBeNull()
    expect(initialAmountFromParam('500', presetsOnly)).toEqual({ amountMinor: 50000, customAmount: '' })
  })
})
