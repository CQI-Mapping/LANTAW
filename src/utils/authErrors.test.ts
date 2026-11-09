// Truthful mapping of GoTrue's sign-in rejections.

import { describe, expect, it } from 'vitest'
import { truthfulAuthError } from './authErrors'

describe('truthfulAuthError', () => {
  it('speaks plainly about an unconfirmed address via its code', () => {
    const out = truthfulAuthError({ code: 'email_not_confirmed', message: 'Email not confirmed' })
    expect(out?.message).toContain('confirmed address')
    expect(out?.reason).toBe('email_not_confirmed')
  })

  it('also recognises the unconfirmed address from the old message wording', () => {
    expect(truthfulAuthError(new Error('Email not confirmed'))?.reason).toBe('email_not_confirmed')
  })

  it('translates the request rate limiter', () => {
    const out = truthfulAuthError({ code: 'over_request_rate_limit', message: 'Over Request Rate Limit', status: 429 })
    expect(out?.message).toBe('Too many attempts — wait a moment and try again.')
    expect(out?.reason).toBe('rate_limited')
  })

  it('recognises the email-send rate limiter too', () => {
    expect(truthfulAuthError({ code: 'over_email_send_rate_limit' })?.reason).toBe('rate_limited')
  })

  it('returns null for credential rejections so the caller stays generic', () => {
    expect(truthfulAuthError({ code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 })).toBeNull()
  })

  it('returns null for anything unrecognised', () => {
    expect(truthfulAuthError(new Error('Some unexpected failure'))).toBeNull()
    expect(truthfulAuthError(null)).toBeNull()
  })
})
