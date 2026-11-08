// Expired / already-used password-recovery link — screen 5 of
// design/profile-reset-redesign.html, translated to the sign-in page's
// classes. App swaps the whole shell for this screen when the bounced URLs
// error params say the emailed link is dead. The honest core of the message:
// nothing was changed — the account's current password still works — and a
// fresh link is one tap away: the sign-in page's Forgot password card
// re-sends it to the same mailbox (an administrator remains the backstop for
// an account whose setup never finished — Resend invite).

interface ResetLinkExpiredProps {
  /** Escape hatch: straight back to the sign-in form. */
  onBackToLogin: () => void
  /** Self-service re-request: back to the sign-in page with its Forgot
   *  password card open, so the loop closes without any administrator. */
  onResendLink: () => void
}

export default function ResetLinkExpired({ onBackToLogin, onResendLink }: ResetLinkExpiredProps) {
  return (
    <div className="login-page">
      {/* Same aurora backdrop as the sign-in screen */}
      <div className="login-blobs" aria-hidden="true">
        <span className="login-blob login-blob--1" />
        <span className="login-blob login-blob--2" />
        <span className="login-blob login-blob--3" />
      </div>

      <div className="login-panel">
        <div className="login-card">
          <div className="login-brand">
            <div className="login-brand-mark"><img src="/LOGO.png" alt="Institute of Computer Studies" className="login-brand-logo" /></div>
            <h1>LANTAW</h1>
            <p className="login-subtitle">NBSC · Institute of Computer Studies</p>
          </div>

          <div className="login-alert login-alert--warn" role="alert">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>
              <b>This link has expired or was already used.</b><br />
              Reset links are single-use and valid for about an hour. Nothing was
              changed — your current password still works. Open a fresh link to try again.
            </span>
          </div>

          <p className="login-reset-description">
            A fresh link is self-service: "Forgot password" on the sign-in page
            sends a new one to the same mailbox. (The administrator "Resend
            invite" remains the backstop if the account's setup never finished.)
          </p>

          <button
            type="button"
            className="login-reset-link login-reset-link--block"
            onClick={onResendLink}
          >
            Send me a fresh link
          </button>
          <button
            type="button"
            className="login-reset-link login-reset-link--block"
            onClick={onBackToLogin}
          >
            ← Back to the sign-in page
          </button>
        </div>

        <p className="login-footer">© 2026 NBSC · Institute of Computer Studies</p>
      </div>
    </div>
  )
}
