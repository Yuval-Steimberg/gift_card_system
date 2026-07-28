import { describe, it, expect } from 'vitest'
import { checkEmail, isValidEmail } from '@/lib/validation/email'

describe('checkEmail — syntax', () => {
  it('accepts ordinary valid addresses', () => {
    expect(checkEmail('yuval@gmail.com').ok).toBe(true)
    expect(checkEmail('first.last@outlook.com').ok).toBe(true)
    expect(checkEmail('name+tag@icloud.com').ok).toBe(true)
    expect(checkEmail('info@justasecond.co.il').ok).toBe(true)
    expect(checkEmail('a_b-c@sub.example.org').ok).toBe(true)
  })

  it('rejects empty / whitespace-only', () => {
    expect(checkEmail('').ok).toBe(false)
    expect(checkEmail('   ').ok).toBe(false)
  })

  it('rejects addresses containing spaces', () => {
    expect(checkEmail('yuval @gmail.com').ok).toBe(false)
    expect(checkEmail('yuval@ gmail.com').ok).toBe(false)
    expect(checkEmail('yu val@gmail.com').ok).toBe(false)
  })

  it('rejects missing or multiple @', () => {
    expect(checkEmail('yuvalgmail.com').ok).toBe(false)
    expect(checkEmail('yuval@@gmail.com').ok).toBe(false)
    expect(checkEmail('yuval@a@gmail.com').ok).toBe(false)
  })

  it('rejects a missing/invalid TLD', () => {
    expect(checkEmail('yuval@gmail').ok).toBe(false)
    expect(checkEmail('yuval@gmail.c').ok).toBe(false)
    expect(checkEmail('yuval@gmail.123').ok).toBe(false)
  })

  it('rejects malformed local/domain parts', () => {
    expect(checkEmail('.yuval@gmail.com').ok).toBe(false)
    expect(checkEmail('yuval.@gmail.com').ok).toBe(false)
    expect(checkEmail('yuval@gmail..com').ok).toBe(false)
    expect(checkEmail('yuval@-gmail.com').ok).toBe(false)
    expect(checkEmail('yuval@gmail-.com').ok).toBe(false)
  })
})

describe('checkEmail — typo detection', () => {
  it('flags known misspellings with a suggestion', () => {
    const r = checkEmail('yuval@gmial.com')
    expect(r.ok).toBe(false)
    expect(r.suggestion).toBe('yuval@gmail.com')
  })

  it('flags gmail.co / gmail.con', () => {
    expect(checkEmail('x@gmail.co').suggestion).toBe('x@gmail.com')
    expect(checkEmail('x@gmail.con').suggestion).toBe('x@gmail.com')
  })

  it('flags edit-distance-1 typos not in the known-typo table', () => {
    // "gmaik.com" (l→k) is not curated, but is one edit from gmail.com.
    const r = checkEmail('x@gmaik.com')
    expect(r.ok).toBe(false)
    expect(r.suggestion).toBe('x@gmail.com')
  })

  it('does not flag a legitimate non-popular domain', () => {
    expect(checkEmail('x@justasecond.co.il').ok).toBe(true)
    expect(checkEmail('x@somecompany.dev').ok).toBe(true)
  })
})

describe('isValidEmail', () => {
  it('mirrors checkEmail.ok', () => {
    expect(isValidEmail('yuval@gmail.com')).toBe(true)
    expect(isValidEmail('yuval@gmial.com')).toBe(false)
    expect(isValidEmail('bad email')).toBe(false)
  })
})
