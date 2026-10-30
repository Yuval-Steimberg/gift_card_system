import { describe, expect, it } from 'vitest'
import { formatValidity } from '@/lib/gift-cards/validity'
import { defaultSystemSettings } from '@/lib/data/seed-data'

describe('formatValidity', () => {
  it('says the validity in words', () => {
    expect(formatValidity(60)).toBe('5 שנים')
    expect(formatValidity(12)).toBe('שנה')
    expect(formatValidity(24)).toBe('שנתיים')
    expect(formatValidity(18)).toBe('18 חודשים')
    expect(formatValidity(1)).toBe('חודש אחד')
    expect(formatValidity(null)).toBe('ללא הגבלת זמן')
  })
  it('defaults new installs to five years', () => {
    expect(defaultSystemSettings().expiryMonths).toBe(60)
  })
})
