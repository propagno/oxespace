import type { ReactElement } from 'react'
import { TOKENS } from '../../../design-system/tokens'

// Type scale matches the --fs-* tokens declared in tokens.css. 14px is the base
// — same baseline used by Codex Desktop and intentionally larger than the old
// scale, which leaned on 10–12px and was uncomfortable on hi-DPI displays.
const SCALE = [
  { label: '11px — chip',    size: '11px', token: '--fs-2xs', weight: 500, usage: 'Status chips, dense badges (last resort)' },
  { label: '12px — meta',    size: '12px', token: '--fs-xs',  weight: 400, usage: 'Metadata, hint text, secondary labels' },
  { label: '13px — list',    size: '13px', token: '--fs-sm',  weight: 400, usage: 'Sidebar items, secondary UI text' },
  { label: '14px — body',    size: '14px', token: '--fs-base',weight: 400, usage: 'Primary UI text (default)' },
  { label: '15px — heading', size: '15px', token: '--fs-lg',  weight: 600, usage: 'Panel headings, section titles' },
  { label: '18px — title',   size: '18px', token: '—',         weight: 600, usage: 'Modal h1, wizard steps' },
]

const SAMPLE_TEXT = 'The quick brown fox jumps over the lazy dog'

export function TypographyScale(): ReactElement {
  return (
    <div className="ds-typography">
      <div className="ds-type-family">
        <h3 className="ds-section-subtitle">UI Font — <code>{TOKENS.font.ui}</code></h3>
        <div className="ds-type-rows">
          {SCALE.map((s) => (
            <div key={s.label} className="ds-type-row">
              <div className="ds-type-meta">
                <span className="ds-type-label">{s.label}</span>
                <span className="ds-type-usage">{s.usage}</span>
              </div>
              <span
                className="ds-type-sample"
                style={{ fontFamily: `var(${TOKENS.font.ui})`, fontSize: s.size, fontWeight: s.weight }}
              >
                {SAMPLE_TEXT}
              </span>
              <span className="ds-type-token" style={{ fontFamily: `var(${TOKENS.font.mono})`, fontSize: 11, color: 'var(--tx-muted)' }}>
                {s.token}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="ds-type-family">
        <h3 className="ds-section-subtitle">Mono Font — <code>{TOKENS.font.mono}</code></h3>
        <div className="ds-type-rows">
          {[{ label: '12px — terminal', size: '12px', weight: 400, usage: 'Terminal output, code, paths' },
            { label: '13px — editor',  size: '13px', weight: 400, usage: 'Editor pane content' }].map((s) => (
            <div key={s.label} className="ds-type-row">
              <div className="ds-type-meta">
                <span className="ds-type-label">{s.label}</span>
                <span className="ds-type-usage">{s.usage}</span>
              </div>
              <span
                className="ds-type-sample"
                style={{ fontFamily: `var(${TOKENS.font.mono})`, fontSize: s.size, fontWeight: s.weight }}
              >
                {'const x = { foo: "bar", count: 42 }  // type-safe'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
