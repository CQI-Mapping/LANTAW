// Appearance — the workspace's look as a full page, entered from the
// profile menu like My Profile and Security & Privacy. The same three
// settings the popover once carried (Color mode, Navbar, Position) with
// room to breathe. The state lives in App, so every pick flips the whole
// app live while the page is open.

import Icon from '../../components/icons'

type ColorMode = 'system' | 'light' | 'dark'
type NavLayout = 'left' | 'top'

const MODES = ['system', 'light', 'dark'] as const
const MODE_LABEL: Record<ColorMode, string> = { system: 'System', light: 'Light', dark: 'Dark' }

interface AppearanceProps {
  colorMode?: ColorMode
  onColorModeChange?: (mode: ColorMode) => void
  navMode?: ColorMode
  onNavModeChange?: (mode: ColorMode) => void
  navLayout?: NavLayout
  onNavLayoutChange?: (layout: NavLayout) => void
  /** The OS's dark preference — a System pick resolves against it live. */
  systemDark?: boolean
}

export default function AppearancePage({
  colorMode = 'light',
  onColorModeChange,
  navMode = 'light',
  onNavModeChange,
  navLayout = 'left',
  onNavLayoutChange,
  systemDark = false,
}: AppearanceProps) {
  const resolvedDark = colorMode === 'dark' || (colorMode === 'system' && systemDark)
  const navResolvedDark = navMode === 'dark' || (navMode === 'system' && systemDark)

  return (
    <div className="programs-page profile">
      <header className="program-hero">
        <div className="program-hero__left">
          <span className="program-hero__icon" aria-hidden="true">
            <Icon name="eye" size={18} />
          </span>
          <div>
            <h2 className="sec-hero__title">Appearance</h2>
            <p className="sec-hero__sub">
              How LANTAW looks across your workspace — colors for the app and the navbars, and where the navigation lives
            </p>
          </div>
        </div>
      </header>

      <div className="app-appear">
        <section className="panel profile-card card-enter" aria-label="Color mode">
          <div className="profile-card__head">
            <h3><Icon name="eye" size={15} />Color mode</h3>
            <span className="profile-card__hint">the whole workspace</span>
          </div>
          <p className="app-appear__desc">
            {colorMode === 'system'
              ? <>Following your system setting — it currently reads <strong>{resolvedDark ? 'dark' : 'light'}</strong>. Flip your OS theme and the app follows.</>
              : colorMode === 'dark'
                ? 'Dark is on for the whole workspace.'
                : 'Light is on for the whole workspace.'}
          </p>
          <div className="app-appear__modes">
            {MODES.map((mode) => (
              <button key={mode} type="button"
                className={`mode-swatch ${colorMode === mode ? 'mode-swatch--selected' : ''}`}
                onClick={() => onColorModeChange?.(mode)}
                aria-pressed={colorMode === mode}>
                <span className={`mode-swatch__preview mode-swatch__preview--${mode}`} aria-hidden="true">
                  <i /><i /><i />
                </span>
                <span className="mode-swatch__label">{MODE_LABEL[mode]}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel profile-card card-enter" aria-label="Navbar colors">
          <div className="profile-card__head">
            <h3><Icon name="target" size={15} />Navbar</h3>
            <span className="profile-card__hint">only the left rail and the top bar</span>
          </div>
          <p className="app-appear__desc">
            {navMode === 'system'
              ? <>Following your system setting — the navbars currently read <strong>{navResolvedDark ? 'dark' : 'light'}</strong>.</>
              : navMode === 'dark'
                ? 'The navbars are dark — a light workspace can carry them.'
                : 'The navbars are light.'}
          </p>
          <div className="app-appear__modes">
            {MODES.map((mode) => (
              <button key={mode} type="button"
                className={`mode-swatch ${navMode === mode ? 'mode-swatch--selected' : ''}`}
                onClick={() => onNavModeChange?.(mode)}
                aria-pressed={navMode === mode}>
                <span className={`mode-swatch__preview mode-swatch__preview--${mode}`} aria-hidden="true">
                  <i /><i /><i />
                </span>
                <span className="mode-swatch__label">{MODE_LABEL[mode]}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel profile-card card-enter" aria-label="Navigation position">
          <div className="profile-card__head">
            <h3><Icon name="list" size={15} />Position</h3>
            <span className="profile-card__hint">where the navigation lives</span>
          </div>
          <p className="app-appear__desc">
            {navLayout === 'top'
              ? 'The navigation sits in a horizontal bar across the top — the workspace takes the full width.'
              : 'The navigation sits in a fixed rail on the left — collapsible, with the workspace beside it.'}
          </p>
          <div className="app-appear__positions">
            <button type="button"
              className={`position-pill ${navLayout === 'left' ? 'selected' : ''}`}
              onClick={() => onNavLayoutChange?.('left')}
              aria-pressed={navLayout === 'left'}>
              Left side
            </button>
            <button type="button"
              className={`position-pill ${navLayout === 'top' ? 'selected' : ''}`}
              onClick={() => onNavLayoutChange?.('top')}
              aria-pressed={navLayout === 'top'}>
              Top bar
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
