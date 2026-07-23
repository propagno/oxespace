import { X } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import { type Theme } from '../../design-system/tokens'
import { OxeLogo } from '../Brand/OxeLogo'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { ColorPalette } from './sections/ColorPalette'
import { ComponentShowcase } from './sections/ComponentShowcase'
import { TypographyScale } from './sections/TypographyScale'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'

/** F1 verification: shadcn/ui + Tailwind primitives rendering with the ported
 *  token layer, proving the foundation coexists with OXESpace's CSS. */
function ShadcnButtonDemo(): ReactElement {
  return (
    <section className="ds-showcase-section" data-testid="shadcn-demo" style={{ marginTop: 24 }}>
      <p className="ds-section-subtitle">shadcn/ui · primitives (F1 foundation)</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button>Default</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="link">Link</Button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="destructive">Destructive</Badge>
        <Badge variant="dot">Dot</Badge>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, maxWidth: 520 }}>
        <Input placeholder="shadcn Input…" />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm">Hover me</Button>
            </TooltipTrigger>
            <TooltipContent>A shadcn tooltip</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Dialog>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="shadcn-dialog-trigger">Open dialog</Button>
          </DialogTrigger>
          <DialogContent data-testid="shadcn-dialog-content">
            <DialogHeader>
              <DialogTitle>Dialog title</DialogTitle>
              <DialogDescription>A ported shadcn dialog on the F1 foundation.</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </div>
      <Separator className="my-4" />
      <Card className="max-w-sm">
        <CardHeader>
          <CardTitle>Card title</CardTitle>
          <CardDescription>Card description text.</CardDescription>
        </CardHeader>
        <CardContent>Card body content, using the ported tokens.</CardContent>
      </Card>
    </section>
  )
}

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

const PROVIDER_ENTRIES: Array<{ provider: 'claude' | 'gh-copilot' | 'antigravity' | 'codex' | 'cursor' | 'custom'; label: string }> = [
  { provider: 'claude',    label: 'Claude' },
  { provider: 'gh-copilot',label: 'Copilot' },
  { provider: 'antigravity', label: 'Antigravity' },
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
          {section === 'components' && <ShadcnButtonDemo />}
        </main>
      </div>
    </div>
  )
}
