import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildTerminalTheme } from '../../src/components/Terminal/terminalViewHelpers'

const ROOT = join(__dirname, '..', '..')
const readCss = (rel: string): string =>
  readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')

const TOUCHED_STYLESHEETS = [
  'src/styles/layout.css',
  'src/styles/project-shell.css',
  'src/styles/components.css',
  'src/styles/controls.css',
  'src/styles/splash.css',
  'src/styles/split-grid.css',
  'src/styles/worktree.css',
  'src/styles/mcp.css',
  'src/styles/skills.css',
  'src/styles/search.css',
  'src/styles/linear.css',
  'src/styles/preview.css',
  'src/styles/scripts-webpreview.css',
  'src/styles/features/pane.css',
  'src/styles/features/terminal.css',
  'src/styles/features/status.css',
  'src/styles/features/review.css',
  'src/styles/features/github.css',
  'src/styles/features/github-actions.css',
  'src/styles/features/agents.css',
  'src/styles/features/editor.css',
  'src/styles/features/integration.css',
  'src/styles/features/oxe-panel.css',
  'src/styles/features/workspace-setup.css',
  'src/components/Navigation/TitleBar.module.css',
  'src/components/Navigation/ModeSwitch.module.css',
  'src/components/Navigation/NavigationChrome.css',
  'src/components/Navigation/NavigationRail.module.css',
  'src/components/Navigation/AppMenuBar.css',
  'src/components/CommandBar/CommandBar.module.css',
  'src/components/CommandBar/CommandBarTrigger.module.css',
  'src/components/Workspace/AppStatusBar.module.css',
  'src/components/Workspace/CodeChrome.css',
  'src/components/Workspace/WorkspaceSettingsModal.css',
  'src/components/OxeQuery/OxeQuery.css',
  'src/components/OxeQuery/StructureEditor.module.css',
  'src/components/OxeQuery/MongoPanels.module.css',
  'src/components/OxeQuery/ConfirmStatements.module.css',
  'src/components/Settings/SettingsCenter.css',
  'src/components/Settings/AppearanceSettings.module.css',
  'src/components/Onboarding/FirstRunChecklist.module.css',
  'src/components/Schedules/Schedules.module.css',
  'src/components/OxePod/OxePod.module.css',
  'src/components/Changes/ChangesPanel.css',
  'src/components/GitHub/GitControlPanel.css',
  'src/components/GitHub/PrStatusBar.css',
  'src/components/MCP/McpCatalog.css'
] as const

afterEach(() => {
  delete document.documentElement.dataset.mode
  delete document.documentElement.dataset.surface
  for (const prop of ['--term-bg', '--term-fg', '--accent', '--fill-selected-strong', '--fill-selected']) {
    document.documentElement.style.removeProperty(prop)
  }
})

describe('OXE-461 · Global app-wide propagation of Obsidian Minimal + Mandacaru', () => {
  it('has zero raw hex/rgb/hsl/oklch color literals and zero deprecated --text-*/--border-* tokens in touched stylesheets', () => {
    const violations: string[] = []
    for (const rel of TOUCHED_STYLESHEETS) {
      const css = readCss(rel)
      for (const [index, rawLine] of css.split('\n').entries()) {
        // Ignore inline data URIs (SVG select chevrons) and neutral shadows if any.
        const line = rawLine.replace(/url\([^)]*\)/g, '')
        if (/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/i.test(line)) {
          violations.push(`${rel}:${index + 1} raw color literal — ${rawLine.trim()}`)
        }
        if (/var\(\s*--(?:text|border)-/.test(line)) {
          violations.push(`${rel}:${index + 1} deprecated token prefix — ${rawLine.trim()}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('aligns xterm.js theme with Dark Default, True Black OLED (pure), Light, and translucent surfaces', () => {
    // Dark Default (#191919 surface, achromatic ANSI neutrals, Mandacaru cursor)
    document.documentElement.dataset.mode = 'dark'
    document.documentElement.dataset.surface = 'default'
    const darkDefault = buildTerminalTheme(false)
    expect(darkDefault.background).toBe('#191919')
    expect(darkDefault.foreground).toBe('#ededed')
    expect(darkDefault.cursor).toBe('#44b77e')
    expect(darkDefault.cursorAccent).toBe('#191919')
    expect(darkDefault.selectionBackground).toBe('#383838')
    expect(darkDefault.selectionInactiveBackground).toBe('#2c2c2c')
    expect(darkDefault.black).toBe('#333333')
    expect(darkDefault.white).toBe('#d7d7d7')
    expect(darkDefault.brightBlack).toBe('#868686')
    expect(darkDefault.brightWhite).toBe('#f5f5f5')
    expect(darkDefault.scrollbarSliderBackground).toBe('rgba(160, 160, 160, 0.22)')

    // True Black OLED (data-mode=dark, data-surface=pure)
    document.documentElement.dataset.surface = 'pure'
    const darkPure = buildTerminalTheme(false)
    expect(darkPure.background).toBe('#000000')
    expect(darkPure.cursorAccent).toBe('#000000')
    expect(darkPure.selectionBackground).toBe('#2a2a2a')
    expect(darkPure.selectionInactiveBackground).toBe('#1f1f1f')

    // Light Default / Pure (terminal keeps achromatic dark canvas + legible Mandacaru cursor & neutral selection)
    document.documentElement.dataset.mode = 'light'
    document.documentElement.dataset.surface = 'default'
    const lightDefault = buildTerminalTheme(false)
    expect(lightDefault.background).toBe('#191919')
    expect(lightDefault.foreground).toBe('#ededed')
    expect(lightDefault.cursor).toBe('#44b77e')
    expect(lightDefault.selectionBackground).toBe('#383838')

    // Translucent mode leaves xterm cells transparent so host tint shows through
    expect(buildTerminalTheme(true).background).toBe('#00000000')

    // Live CSS custom properties override defaults cleanly when computed styles are present
    document.documentElement.dataset.mode = 'dark'
    document.documentElement.dataset.surface = 'pure'
    document.documentElement.style.setProperty('--term-bg', '#000000')
    document.documentElement.style.setProperty('--term-fg', '#ededed')
    document.documentElement.style.setProperty('--accent', '#44b77e')
    document.documentElement.style.setProperty('--fill-selected-strong', '#2a2a2a')
    const fromTokens = buildTerminalTheme(false)
    expect(fromTokens.background).toBe('#000000')
    expect(fromTokens.selectionBackground).toBe('#2a2a2a')
  })

  it('enforces Obsidian Minimal hairline chrome on Shell, TitleBar, StatusBar, Panes, and Splash', () => {
    const titleBar = readCss('src/components/Navigation/TitleBar.module.css')
    expect(titleBar).toMatch(/\.bar\s*\{[^}]*background:\s*var\(--surface-chrome\)/)
    expect(titleBar).toMatch(/\.bar\s*\{[^}]*border-bottom:\s*1px solid var\(--bd-subtle\)/)

    const statusBar = readCss('src/components/Workspace/AppStatusBar.module.css')
    expect(statusBar).toMatch(/\.bar\s*\{[^}]*background:\s*var\(--surface-chrome\)/)
    expect(statusBar).toMatch(/\.bar\s*\{[^}]*border-top:\s*1px solid var\(--bd-subtle\)/)

    const navChrome = readCss('src/components/Navigation/NavigationChrome.css')
    expect(navChrome).toMatch(/\.app-shell\s*>\s*:is\(\.sidebar\.sidebar-redesign,\s*\.thread-navigation\)\s*\{[^}]*background:\s*var\(--surface-chrome\)/)
    expect(navChrome).toMatch(/\.app-shell\s*>\s*:is\(\.sidebar\.sidebar-redesign,\s*\.thread-navigation\)\s*\{[^}]*border-right:\s*1px solid var\(--bd-subtle\)/)

    // OXE-451 invariant: .app-shell never animates grid-template-columns
    const baseCss = readCss('src/styles/base.css')
    expect(baseCss).not.toMatch(/grid-template-columns\s+\d|transition[^;]*grid-template-columns/)

    const paneCss = readCss('src/styles/features/pane.css')
    expect(paneCss).toMatch(/\.pane-container\s*\{[^}]*border:\s*1px solid var\(--bd-subtle\)/)
    expect(paneCss).toMatch(/\.pane-container\s*\{[^}]*box-shadow:\s*none/)
    expect(paneCss).not.toMatch(/\.pane-container\.active\s*\{[^}]*!important/)

    const layoutCss = readCss('src/styles/layout.css')
    expect(layoutCss).not.toMatch(/linear-gradient/)
    expect(layoutCss).toMatch(/\.sidebar\s*\{[^}]*box-shadow:\s*none/)

    const skillsCss = readCss('src/styles/skills.css')
    expect(skillsCss).not.toMatch(/linear-gradient/)

    const splashCss = readCss('src/styles/splash.css')
    expect(splashCss).toMatch(/:root\[data-mode='dark'\]\s+\.oxe-splash-tile\s*\{[^}]*stroke:\s*var\(--bd-subtle\)/)
    expect(splashCss).toMatch(/\.oxe-splash\s*\{[^}]*background:\s*var\(--surface-canvas\)/)
  })

  it('enforces Obsidian Minimal table craft and hairline separation in OxeQuery', () => {
    const oqCss = readCss('src/components/OxeQuery/OxeQuery.css')
    expect(oqCss).not.toMatch(/--ov-3\b/)
    expect(oqCss).toMatch(/\.oq-grid-header\s*>\s*span,\s*\.oq-grid-row\s*>\s*span\s*\{[^}]*border-right:\s*0/)
    expect(oqCss).toMatch(/\.oq-grid-row\s*\{[^}]*border-bottom:\s*1px solid var\(--bd-subtle\)/)
    expect(oqCss).toMatch(/\.oq-grid-row:hover\s*\{[^}]*background:\s*var\(--fill-hover\)/)
    expect(oqCss).toMatch(/\.oq-grid-row\.is-selected\s*\{[^}]*background:\s*var\(--fill-selected\)/)
    expect(oqCss).toMatch(/\.oq-grid-header\s*\{[^}]*background:\s*var\(--surface-sunken\)/)
    expect(oqCss).toMatch(/\.oq-grid-header\s*\{[^}]*color:\s*var\(--tx-muted\)/)
  })
})
