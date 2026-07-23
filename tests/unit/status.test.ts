import { describe, it, expect } from 'vitest'
import { canTransition, assertTransition, statusForBalance, IllegalStatusTransitionError } from '@/lib/gift-cards/status'

describe('status machine', () => {
  it('allows documented transitions', () => {
    expect(canTransition('active', 'partially_redeemed')).toBe(true)
    expect(canTransition('active', 'suspended')).toBe(true)
    expect(canTransition('suspended', 'active')).toBe(true)
    expect(canTransition('partially_redeemed', 'fully_redeemed')).toBe(true)
    expect(canTransition('active', 'refunded')).toBe(true)
  })

  it('rejects illegal transitions', () => {
    expect(canTransition('cancelled', 'active')).toBe(false)
    expect(canTransition('fully_redeemed', 'active')).toBe(false)
    expect(canTransition('refunded', 'active')).toBe(false)
    expect(() => assertTransition('cancelled', 'active')).toThrow(IllegalStatusTransitionError)
  })

  it('derives balance-driven status', () => {
    expect(statusForBalance('active', 0, 10000)).toBe('fully_redeemed')
    expect(statusForBalance('active', 5000, 10000)).toBe('partially_redeemed')
    expect(statusForBalance('active', 10000, 10000)).toBe('active')
    // sticky states are not recomputed
    expect(statusForBalance('suspended', 0, 10000)).toBe('suspended')
  })
})
