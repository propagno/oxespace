import { useEffect, useState, type ReactElement } from 'react'
import { THEMES, TOKENS, resolveToken, type Theme } from '../../../design-system/tokens'

interface Swatch {
  label: string
  token: string
}

const BG_SWATCHES: Swatch[] = [
  { label: 'bg-app',          token: TOKENS.color.bgApp },
  { label: 'bg-sidebar',      token: TOKENS.color.bgSidebar },
  { label: 'bg-elevated',     token: TOKENS.color.bgElevated },
  { label: 'bg-tile',         token: TOKENS.color.bgTile },
  { label: 'bg-tile-header',  token: TOKENS.color.bgTileHeader },
  { label: 'bg-modal',        token: TOKENS.color.bgModal },
  { label: 'bg-input',        token: TOKENS.color.bgInput },
  { label: 'bg-statusbar',    token: TOKENS.color.bgStatusbar },
  { label: 'bg-ws-active',    token: TOKENS.color.bgWsActive },
]

const TEXT_SWATCHES: Swatch[] = [
  { label: 'tx-primary',    token: TOKENS.color.txPrimary },
  { label: 'tx-secondary',  token: TOKENS.color.txSecondary },
  { label: 'tx-muted',      token: TOKENS.color.txMuted },
  { label: 'tx-label',      token: TOKENS.color.txLabel },
  { label: 'tx-agent-meta', token: TOKENS.color.txAgentMeta },
]

const ACCENT_SWATCHES: Swatch[] = [
  { label: 'accent',       token: TOKENS.color.accent },
  { label: 'accent-hover', token: TOKENS.color.accentHover },
  { label: 'brand',        token: TOKENS.color.brand },
  { label: 'brand-light',  token: TOKENS.color.brandLight },
  { label: 'bd-ws-active', token: TOKENS.color.bdWsActive },
]

const DOT_SWATCHES: Swatch[] = [
  { label: 'green',  token: TOKENS.color.dotGreen },
  { label: 'blue',   token: TOKENS.color.dotBlue },
  { label: 'yellow', token: TOKENS.color.dotYellow },
  { label: 'orange', token: TOKENS.color.dotOrange },
  { label: 'red',    token: TOKENS.color.dotRed },
  { label: 'purple', token: TOKENS.color.dotPurple },
  { label: 'gray',   token: TOKENS.color.dotGray },
]

function SwatchGrid({ title, swatches }: { title: string; swatches: Swatch[] }): ReactElement {
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    const resolved: Record<string, string> = {}
    for (const s of swatches) resolved[s.token] = resolveToken(s.token)
    setValues(resolved)
  }, [swatches])

  return (
    <div className="ds-swatch-group">
      <h3 className="ds-section-subtitle">{title}</h3>
      <div className="ds-swatch-grid">
        {swatches.map((s) => (
          <div key={s.token} className="ds-swatch-item">
            <div
              className="ds-swatch-color"
              style={{ background: `var(${s.token})` }}
              title={values[s.token]}
            />
            <span className="ds-swatch-label">{s.label}</span>
            <span className="ds-swatch-value">{values[s.token] ?? '…'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface ColorPaletteProps {
  theme: Theme
  onThemeChange: (t: Theme) => void
}

export function ColorPalette({ theme, onThemeChange }: ColorPaletteProps): ReactElement {
  return (
    <div className="ds-color-palette">
      <div className="ds-controls-row">
        <div className="ds-control-group">
          <span className="ds-control-label">Theme</span>
          <div className="ds-chip-row">
            {THEMES.map((t) => (
              <button
                key={t}
                type="button"
                className={`ds-chip ${theme === t ? 'active' : ''}`}
                onClick={() => { onThemeChange(t) }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <SwatchGrid title="Backgrounds" swatches={BG_SWATCHES} />
      <SwatchGrid title="Text" swatches={TEXT_SWATCHES} />
      <SwatchGrid title="Accents & Brand" swatches={ACCENT_SWATCHES} />
      <SwatchGrid title="Status Dots" swatches={DOT_SWATCHES} />
    </div>
  )
}
