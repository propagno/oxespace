import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OxeLogo } from '../../src/components/Brand/OxeLogo'
import { DesignSystemPage } from '../../src/components/DesignSystem/DesignSystemPage'
import { MARK_ARM_LEFT, MARK_ARM_RIGHT, MARK_PATH, MARK_TRUNK } from '../../src/design/brand'
import { AgoraIcon } from '../../src/design/icons/AgoraIcon'
import { HistoryIcon } from '../../src/design/icons/HistoryIcon'
import { OxeChatIcon } from '../../src/design/icons/OxeChatIcon'
import { OxeCodeIcon } from '../../src/design/icons/OxeCodeIcon'
import { OxePodIcon } from '../../src/design/icons/OxePodIcon'
import { OxePostIcon } from '../../src/design/icons/OxePostIcon'
import { OxeQueryIcon } from '../../src/design/icons/OxeQueryIcon'
import { COLOR_SCHEMES } from '../../src/design/mode'
import { LOGO } from '../../src/design/tokens/palette'
import { schemeColorRoles } from '../../src/design/tokens/schemes'
import { surfaceColorRoles } from '../../src/design/tokens/semantic'
import { BrandLoader, BrandMark } from '../../src/ui'
import { AgentsIcon } from '../../src/ui/icons/AgentsIcon'

const ROOT = join(__dirname, '..', '..')
const readText = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.density
  delete document.documentElement.dataset.surface
  delete document.documentElement.dataset.scheme
})

describe('OXE-469 · Monochrome Mandacaru Ramo logo, clean Minimal icons & retired Mandacaru copy', () => {
  it('sets LOGO to monochrome Obsidian Minimal (#212121 / #d8d8d8), removes green, and preserves OxeLogo Ramo geometry', () => {
    expect(LOGO).toEqual({ tile: '#212121', mark: '#d8d8d8' })
    expect(LOGO.mark.toLowerCase()).not.toBe('#3fbf82')

    // brand-mark stays calm monochrome Minimal ink matching text-primary across modes, surfaces, and schemes.
    for (const mode of ['light', 'dark'] as const) {
      for (const surface of ['default', 'pure'] as const) {
        const base = surfaceColorRoles(mode, surface)
        expect(base['brand-mark']).toBe(base['text-primary'])
        for (const scheme of COLOR_SCHEMES) {
          const roles = schemeColorRoles(scheme, mode, surface)
          expect(roles['brand-mark']).toBe(roles['text-primary'])
        }
      }
    }

    const { container } = render(<OxeLogo size={32} variant="full" />)
    const svg = container.querySelector('svg[data-ui="brand-mark"]')!
    expect(svg).not.toBeNull()
    expect(svg.querySelector('rect')).not.toBeNull()
    expect(svg.querySelector('path')?.getAttribute('d')).toBe(MARK_PATH)

    // Generated icon.svg and Android launcher resources carry the monochrome colors.
    const iconSvg = readText('resources/icon.svg')
    expect(iconSvg).toContain('fill="#212121"')
    expect(iconSvg).toContain('fill="#d8d8d8"')
    expect(iconSvg).not.toMatch(/3fbf82/i)
  })

  it('replaces cactus, thorn, and sun-ray motifs in mode icons and AgentsIcon with clean Minimal drawings', () => {
    const chat = render(<OxeChatIcon />).container
    const chatPaths = [...chat.querySelectorAll('path')].map(el => el.getAttribute('d') ?? '')
    expect(chatPaths).not.toContain('M12 9v4M12 11h-2.5V9.5M12 10.5h2.5V9')
    expect(chatPaths).toHaveLength(2)
    cleanup()

    const code = render(<OxeCodeIcon />).container
    const codePaths = [...code.querySelectorAll('path')].map(el => el.getAttribute('d') ?? '')
    expect(code.querySelector('rect')).not.toBeNull()
    expect(codePaths).not.toContain('M17 4V2.5')
    expect(codePaths).toHaveLength(1)
    cleanup()

    const query = render(<OxeQueryIcon />).container
    const queryPaths = [...query.querySelectorAll('path')].map(el => el.getAttribute('d') ?? '')
    expect(query.querySelector('ellipse')).not.toBeNull()
    expect(queryPaths).not.toContain('M12 11v6M12 13.5H9.5V12')
    expect(queryPaths).toHaveLength(2)
    cleanup()

    const pod = render(<OxePodIcon />).container
    const podPaths = [...pod.querySelectorAll('path')].map(el => el.getAttribute('d') ?? '')
    expect(podPaths).not.toContain('M8 5.2 7 3.6M16 5.2l1-1.6')
    expect(podPaths).toHaveLength(2)
    cleanup()

    const post = render(<OxePostIcon />).container
    expect(post.querySelector('circle')).not.toBeNull()
    expect(post.querySelectorAll('path')).toHaveLength(2)
    cleanup()

    const agora = render(<AgoraIcon />).container
    const agoraPaths = [...agora.querySelectorAll('path')].map(el => el.getAttribute('d') ?? '')
    expect(agoraPaths).not.toContain('M12 4v4M5.6 6.6l1.8 1.8M18.4 6.6l-1.8 1.8')
    expect(agoraPaths).toHaveLength(2)
    expect(agora.querySelector('circle')).not.toBeNull()
    cleanup()

    const history = render(<HistoryIcon />).container
    expect(history.querySelector('path[d="M3 12h18"]')).not.toBeNull()
    cleanup()

    const agents = render(<AgentsIcon />).container
    const agentsPaths = [...agents.querySelectorAll('path')].map(el => el.getAttribute('d') ?? '')
    expect(agentsPaths).not.toContain('M8 14V3M8 10H5.5A1.5 1.5 0 0 1 4 8.5V6M8 7.5h2.5A1.5 1.5 0 0 0 12 6V4')
    expect(agents.querySelectorAll('circle')).toHaveLength(3)
    expect(AgentsIcon.iconName).toBe('agents')
  })

  it('replaces the sprouting cactus BrandLoader with a circular Minimal spinner while keeping BrandMark Ramo geometry', () => {
    const { container } = render(<BrandLoader label="Syncing workspace" size={32} />)
    const status = screen.getByRole('status', { name: 'Syncing workspace' })
    expect(status).toHaveAttribute('data-brand-loader', '')
    const svg = status.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.querySelectorAll('circle')).toHaveLength(1)
    const loaderPaths = [...svg.querySelectorAll('path')].map(el => el.getAttribute('d') ?? '')
    expect(loaderPaths).toHaveLength(1)
    for (const cactusPart of [MARK_TRUNK, MARK_ARM_LEFT, MARK_ARM_RIGHT]) {
      expect(loaderPaths).not.toContain(cactusPart)
    }
    expect(container.querySelector('[data-brand-loader]')).toBe(status)
    cleanup()

    const mark = render(<BrandMark size={40} />).container
    expect(mark.querySelector('svg path')?.getAttribute('d')).toBe(MARK_PATH)
  })

  it('retires Caatinga/Mandacaru UI copy in settings locales and DesignSystemPage, and switches all 8 Minimal schemes live', () => {
    for (const locale of ['en', 'pt-BR'] as const) {
      const text = readText(`shared/locales/${locale}/settings.json`)
      expect(text, `${locale}/settings.json`).not.toMatch(/caatinga|mandacaru/i)
    }
    expect(readText('shared/locales/en/settings.json')).toContain('Quiet dark surfaces in the Obsidian Minimal palette')
    expect(readText('shared/locales/pt-BR/settings.json')).toContain('Superfícies escuras silenciosas no padrão Obsidian Minimal')

    render(<DesignSystemPage onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'Design system' })
    expect(dialog.textContent).not.toMatch(/mandacaru|caatinga/i)
    expect(dialog).toHaveAttribute('data-scheme', 'default')

    const schemeSelect = screen.getByRole('combobox', { name: 'Color scheme' }) as HTMLSelectElement
    expect([...schemeSelect.options].map(opt => opt.value)).toEqual([...COLOR_SCHEMES])

    for (const scheme of COLOR_SCHEMES) {
      fireEvent.change(schemeSelect, { target: { value: scheme } })
      expect(dialog).toHaveAttribute('data-scheme', scheme)
      expect(dialog.querySelectorAll(`[data-mode="light"][data-scheme="${scheme}"]`).length).toBeGreaterThan(0)
      expect(dialog.querySelectorAll(`[data-mode="dark"][data-scheme="${scheme}"]`).length).toBeGreaterThan(0)
    }

    fireEvent.click(screen.getByRole('button', { name: '1.5.2 Primitives' }))
    expect(dialog.textContent).not.toMatch(/mandacaru/i)
    expect(screen.getAllByText('minimal').length).toBeGreaterThan(0)

    // Status bar follows Obsidian Minimal quiet muted chrome with smooth hover brighten.
    const statusBarCss = readText('src/components/Workspace/AppStatusBar.module.css')
    expect(statusBarCss).toMatch(/\.bar\s*\{[^}]*color:\s*var\(--tx-muted\)/)
    expect(statusBarCss).toMatch(/\.bar\s*\{[^}]*transition:\s*color var\(--duration-base\) var\(--ease-linear\)/)
    expect(statusBarCss).toMatch(/\.bar:hover\s+\.strong[^{]*\{[^}]*color:\s*var\(--tx-primary\)/)
  })
})
