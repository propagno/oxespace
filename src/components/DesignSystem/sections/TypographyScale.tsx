import type { ReactElement } from 'react'
import { TOKENS } from '../../../design-system/tokens'

const SCALE = [
  { label: '10px — label',   size: '10px', weight: 400, usage: 'Status bar, meta labels' },
  { label: '11px — meta',    size: '11px', weight: 400, usage: 'Timestamps, badges, captions' },
  { label: '12px — body',    size: '12px', weight: 400, usage: 'Sidebar items, list content' },
  { label: '13px — heading', size: '13px', weight: 500, usage: 'Section headings, modal titles' },
  { label: '14px — large',   size: '14px', weight: 500, usage: 'Buttons, inputs, pane headers' },
  { label: '18px — title',   size: '18px', weight: 600, usage: 'Modal h1, wizard steps' },
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
