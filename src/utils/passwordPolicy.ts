// Shared password policy — the single source of truth for every password
// form (Security & Privacy page, reset screen). The Supabase project also
// enforces a minimum length in its own auth config; keeping the number here
// means the client's checklist can never drift from one form to another.

/** Minimum accepted password length — mirrors the auth config. */
export const MIN_PASSWORD_LENGTH = 8

/** How many character families (lower / upper / digit / symbol) a password touches. */
export function passwordVariety(password: string): number {
  return [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^a-zA-Z0-9]/.test(password),
  ].filter(Boolean).length
}

/**
 * 0 → empty, small value → below the floor, otherwise a blend of length and
 * character variety that fills the strength bar. Same curve the profile
 * password card has always used, now shared by every password form.
 */
export function passwordStrength(password: string): number {
  if (!password) return 0
  if (password.length < MIN_PASSWORD_LENGTH) return 0.15
  return 0.45 + 0.55 * (0.7 * Math.min(password.length / 16, 1) + 0.3 * (passwordVariety(password) / 4))
}

/**
 * A strong suggestion for "temporary password" fields on the create forms:
 * one guaranteed character per family, then random fill, drawn with crypto
 * so no two invites share a pattern. Ambiguous glyphs (l, I, O, 0, 1) are
 * left out of the families where possible — a password handed over verbally
 * survives being read aloud.
 */
export function suggestStrongPassword(length = 16): string {
  const families = ['abcdefghijkmnpqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%*_-?']
  const pool = families.join('')
  const rand = (max: number) => crypto.getRandomValues(new Uint32Array(1))[0] % max
  return families
    .map((f) => f[rand(f.length)])
    .concat(Array.from({ length: length - families.length }, () => pool[rand(pool.length)]))
    .join('')
}
