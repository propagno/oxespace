import { X } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import { type Theme } from '../../design-system/tokens'
import { OxeLogo } from '../Brand/OxeLogo'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { ColorPalette } from './sections/ColorPalette'
import { ComponentShowcase } from './sections/ComponentShowcase'
import { TypographyScale } from './sections/TypographyScale'

type Section = 'brand' | 'colors' | 'typography' | 'components'

const NAV: { id: Section; label: string }[] = [
  { id: 'brand',       label: 'Brand' },
  { id: 'colors',      label: 'Colors' },
  { id: 'typography',  label: 'Typography' },
  { id: 'components',  label: 'Components' },
]

const BRAND_TOKENS = [
  { name: '--brand',         label: 'Brand' },
  { name: '--brand-light',   label: 'Brand Light' },
  { name: '--brand-lightest',label: 'Brand Lightest' },
  { name: '--brand-dark',    label: 'Brand Dark' },
]

const PROVIDER_ENTRIES: Array<{ provider: 'claude' | 'gh-copilot' | 'gemini' | 'codex' | 'cursor' | 'custom'; label: string }> = [
  { provider: 'claude',    label: 'Claude' },
  { provider: 'gh-copilot',label: 'Copilot' },
  { provider: 'gemini',    label: 'Gemini' },
  { provider: 'codex',     label: 'Codex' },
  { provider: 'cursor',    label: 'Cursor' },
  { provider: 'custom',    label: 'Custom' },
]

const AVATAR_TOKENS = [
  { name: '--avatar-1', label: 'Avatar 1' },
  { name: '--avatar-2', label: 'Avatar 2' },
  { name: '--avatar-3', label: 'Avatar 3' },
  { name: '--avatar-4', label: 'Avatar 4' },
  { name: '--avatar-5', label: 'Avatar 5' },
  { name: '--avatar-6', label: 'Avatar 6' },
]

function BrandSection(): ReactElement {
  return (
    <div className="ds-showcase" style={{ gap: 32 }}>
      <section className="ds-showcase-section">
        <p className="ds-section-subtitle">Logo</p>
        <div className="ds-showcase-row" style={{ gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <OxeLogo size={28} />
            <span style={{ fontSize: 11, color: 'var(--tx-muted)' }}>28px · full</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <OxeLogo size={48} />
            <span style={{ fontSize: 11, color: 'var(--tx-muted)' }}>48px · full</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <OxeLogo size={24} variant="compact" />
            <span style={{ fontSize: 11, color: 'var(--tx-muted)' }}>24px · compact</span>
          </div>
        </div>
      </section>

      <section className="ds-showcase-section">
        <p className="ds-section-subtitle">Wordmark + Hero</p>
        <div className="ds-showcase-row" style={{ gap: 32, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <OxeLogo size={22} variant="wordmark" />
            <span style={{ fontSize: 11, color: 'var(--tx-muted)' }}>22px · wordmark (sidebar)</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <OxeLogo size={28} variant="wordmark" />
            <span style={{ fontSize: 11, color: 'var(--tx-muted)' }}>28px · wordmark (header)</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <OxeLogo size={72} variant="hero" />
            <span style={{ fontSize: 11, color: 'var(--tx-muted)' }}>72px · hero (empty state / splash)</span>
          </div>
        </div>
      </section>

      <section className="ds-showcase-section">
        <p className="ds-section-subtitle">Brand Palette</p>
        <div className="ds-swatch-grid">
          {BRAND_TOKENS.map(({ name, label }) => (
            <div key={name} className="ds-swatch-item">
              <div className="ds-swatch-color" style={{ background: `var(${name})` }} />
              <span className="ds-swatch-label">{label}</span>
              <span className="ds-swatch-value" style={{ fontFamily: 'var(--font-mono)', fontSize: 9 }}>{name}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="ds-showcase-section">
        <p className="ds-section-subtitle">Provider Icons</p>
        <div className="ds-showcase-row" style={{ flexWrap: 'wrap', gap: 16 }}>
          {PROVIDER_ENTRIES.map(({ provider, label }) => (
            <div key={provider} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <AgentProviderIcon provider={provider} />
              <span style={{ fontSize: 10, color: 'var(--tx-muted)' }}>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="ds-showcase-section">
        <p className="ds-section-subtitle">Avatar Palette</p>
        <div className="ds-swatch-grid">
          {AVATAR_TOKENS.map(({ name, label }) => (
            <div key={name} className="ds-swatch-item">
              <div className="ds-swatch-color" style={{ background: `var(${name})`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700 }}>
                {label.at(-1)}
              </div>
              <span className="ds-swatch-label">{label}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

interface DesignSystemPageProps {
  onClose: () => void
}

export function DesignSystemPage({ onClose }: DesignSystemPageProps): ReactElement {
  const [section, setSection] = useState<Section>('brand')
  const [theme, setTheme]     = useState<Theme>('default')

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'default') {
      root.removeAttribute('data-theme')
    } else {
      root.setAttribute('data-theme', theme)
    }
    return () => { root.removeAttribute('data-theme') }
  }, [theme])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => { window.removeEventListener('keydown', handler) }
  }, [onClose])

  return (
    <div className="ds-overlay" role="dialog" aria-modal="true" aria-label="Design System Viewer">
      <div className="ds-panel">
        <header className="ds-header">
          <h2 className="ds-title">OXESpace Design System</h2>
          <button type="button" className="icon-button" aria-label="Close design system" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <nav className="ds-nav">
          {NAV.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`ds-nav-item ${section === id ? 'active' : ''}`}
              onClick={() => { setSection(id) }}
            >
              {label}
            </button>
          ))}
        </nav>

        <main className="ds-content">
          {section === 'brand'      && <BrandSection />}
          {section === 'colors'     && <ColorPalette theme={theme} onThemeChange={setTheme} />}
          {section === 'typography' && <TypographyScale />}
          {section === 'components' && <ComponentShowcase />}
        </main>
      </div>
    </div>
  )
}
