// GoTrue's password sign-in returns several distinct 400s that the UI used
// to collapse into one misleading sentence ("Invalid email or password."):
// an unconfirmed address and the shared rate limiter each read exactly like
// a wrong password, sending people chasing credentials that were never
// wrong. These helpers translate the known codes (read off AuthError.code
// first, falling back to the message wording that older server versions
// return) into flow-safe plain language, and return null for anything
// unrecognised so callers keep their existing branches — the
// service-failure wording, then the generic credential sentence.
//
// Enumeration safety: none of the messages implies whether an address
// exists — they speak only about this attempt's circumstances.

/** Plain-language, flow-safe auth error text plus its audit reason, else null. */
export function truthfulAuthError(err: unknown): { message: string; reason: string } | null {
  const e = (err ?? {}) as { code?: string; message?: string }
  const code = e.code ?? ''
  const msg = (e.message ?? '').toLowerCase()

  // An unconfirmed address. Newer GoTrue reports a dedicated code; older
  // versions carried a plain message (sometimes folded under the
  // invalid_credentials code too, hence the wording check).
  if (code === 'email_not_confirmed' || /email.?not.?confirmed/.test(msg)) {
    return {
      message:
        'First sign-in needs a confirmed address — check your inbox (or ask an administrator to resend the invite).',
      reason: 'email_not_confirmed',
    }
  }
  // The shared rate limiter (HTTP 429), on sign-ins and password-email
  // sends alike.
  if (
    code === 'over_request_rate_limit' ||
    code === 'over_email_send_rate_limit' ||
    /over.?request.?rate.?limit|rate.?limit.?exceeded|too many requests/.test(msg)
  ) {
    return { message: 'Too many attempts — wait a moment and try again.', reason: 'rate_limited' }
  }
  return null
}
