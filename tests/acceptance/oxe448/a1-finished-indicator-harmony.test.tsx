// Frozen acceptance test for OXE-448 (163-roadmap/F1, A1-A3). The executor must not edit it after runtime compile.
// Harmonizes the OxeChat sidebar completed (`Finished`) indicator inside the 12px `.indicator` box (`--space-3`):
// replaces overflowing 14px `CircleCheck` in `--intent-success-solid` with a minimal 12px `Check` (`strokeWidth={2}`)
// optically aligned on line 1 (`display: block` on `.indicator svg`) in a quiet semantic token with WCAG AA contrast
// across light and dark modes, while keeping actionable states (`running`, `attention`, `failed`) prominent and distinct.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationThread } from '../../../shared/types/thread'
import { ThreadSidebarRow } from '../../../src/components/Threads/ThreadSidebarRow'
import { contrast, over } from '../../../src/design/tokens/color'
import { colorRoles } from '../../../src/design/tokens/semantic'
import { changeLanguage, i18n } from '../../../src/i18n'

const ROOT = process.cwd()
const CSS_PATH = join(ROOT, 'src/components/Threads/ThreadSidebar.module.css')
const ROW_PATH = join(ROOT, 'src/components/Threads/ThreadSidebarRow.tsx')
const TOKENS_CSS_PATH = join(ROOT, 'src/styles/tokens.generated.css')

const makeThread = (overrides: Partial<ConversationThread> = {}): ConversationThread => ({
  id: 'thread-oxe448',
  workspaceId: 'thread:project-1',
  projectId: 'project-1',
  rootPath: '/repos/oxespace',
  provider: 'codex',
  nativeSessionId: null,
  title: 'oi',
  pinned: false,
  status: 'idle',
  lastTurnStatus: 'completed',
  createdAt: 100,
  updatedAt: 200,
  ...overrides
})

const renderRow = (overrides: Partial<ConversationThread> = {}, options: { selected?: boolean; unread?: boolean; child?: boolean } = {}) =>
  render(
    <ThreadSidebarRow
      thread={makeThread(overrides)}
      selected={options.selected ?? false}
      unread={options.unread ?? false}
      child={options.child ?? false}
      time="1m"
      onSelect={vi.fn()}
      onMenu={vi.fn()}
      onOpenRequest={vi.fn()}
    />
  )

/** Extracts the declaration block body for an exact selector in CSS (comments stripped). */
function ruleBody(css: string, selector: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|[}\\r\\n])\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(clean)
  return match?.[1]?.trim() ?? ''
}

/** Resolves a canonical CSS token name (`--tx-muted`, `--intent-success-fg`, etc.) against `colorRoles(mode)`. */
function resolveRoleHex(token: string, mode: 'light' | 'dark'): string {
  const roles = colorRoles(mode)
  const key = token.startsWith('--tx-') ? `text-${token.slice('--tx-'.length)}` : token.slice(2)
  const value = roles[key]
  if (!value) throw new Error(`Unknown color role for token ${token} (${key}) in ${mode} mode`)
  return value
}

afterEach(async () => {
  cleanup()
  await changeLanguage('en')
})

describe('OXE-448 · Harmonize completed (Finished) indicator in OxeChat sidebar', () => {
  it('A1: completed row renders minimal Check icon (<=12px, strokeWidth 2) inside 12px indicator without CircleCheck or overflow', () => {
    for (const selected of [false, true]) {
      cleanup()
      const { container } = renderRow({ title: 'Revisão rápida ✅' }, { selected })
      const row = container.querySelector<HTMLElement>('[data-ui="sidebar-row"]')
      expect(row).not.toBeNull()
      expect(row).toHaveAttribute('data-lines', '2')
      expect(row).toHaveAttribute('data-status', 'completed')
      expect(row?.querySelector('[data-ui="row-title"]')).toHaveTextContent('Revisão rápida ✅')
      expect(row?.querySelector('[data-ui="row-meta"]')).toHaveTextContent('Finished')

      const indicator = row?.querySelector<HTMLElement>('.thread-session-indicator')
      expect(indicator).not.toBeNull()
      expect(indicator).toHaveAttribute('data-status', 'completed')
      expect(indicator).toHaveAttribute('aria-hidden', 'true')

      const svg = indicator?.querySelector<SVGSVGElement>('svg')
      expect(svg).not.toBeNull()
      const svgClasses = (svg?.getAttribute('class') ?? '').split(/\s+/)
      expect(svgClasses).toContain('lucide-check')
      expect(svgClasses).not.toContain('lucide-circle-check')
      expect(svg?.querySelector('circle')).toBeNull()
      expect(svg?.querySelectorAll('path').length).toBeGreaterThanOrEqual(1)

      const width = Number(svg?.getAttribute('width'))
      const height = Number(svg?.getAttribute('height'))
      expect(width).toBeGreaterThanOrEqual(10)
      expect(width).toBeLessThanOrEqual(12)
      expect(height).toBeGreaterThanOrEqual(10)
      expect(height).toBeLessThanOrEqual(12)
      expect(Number(svg?.getAttribute('stroke-width'))).toBe(2)
    }

    const css = readFileSync(CSS_PATH, 'utf8')
    const indicatorBox = ruleBody(css, '.indicator')
    expect(indicatorBox).toMatch(/width:\s*var\(--space-3\)/)
    expect(indicatorBox).toMatch(/height:\s*var\(--space-3\)/)
    expect(indicatorBox).toMatch(/align-items:\s*center/)
    expect(indicatorBox).toMatch(/justify-content:\s*center/)

    const indicatorSvg = ruleBody(css, '.indicator svg')
    expect(indicatorSvg).toMatch(/display:\s*block/)
    expect(indicatorSvg).toMatch(/flex-shrink:\s*0/)

    const completedRule = ruleBody(css, ".indicator[data-status='completed']")
    expect(completedRule).not.toBe('')
    expect(completedRule).not.toContain('--intent-success-solid')
  })

  it('A2: actionable states keep primary solid emphasis while all six states and edge variants preserve anatomy', async () => {
    const cases: Array<{
      name: string
      overrides: Partial<ConversationThread>
      kind: string
      label: string
      svgClass: string | null
    }> = [
      { name: 'running', overrides: { status: 'running', lastTurnStatus: undefined }, kind: 'running', label: 'Working', svgClass: null },
      { name: 'attention', overrides: { status: 'approval', lastTurnStatus: undefined }, kind: 'attention', label: 'Needs you', svgClass: 'lucide-sun' },
      { name: 'failed', overrides: { status: 'failed', lastTurnStatus: 'failed' }, kind: 'failed', label: 'Failed', svgClass: 'lucide-circle-x' },
      { name: 'completed', overrides: { status: 'idle', lastTurnStatus: 'completed' }, kind: 'completed', label: 'Finished', svgClass: 'lucide-check' },
      { name: 'ready', overrides: { status: 'idle', lastTurnStatus: undefined }, kind: 'ready', label: 'Idle', svgClass: 'lucide-circle' },
      { name: 'interrupted', overrides: { status: 'interrupted', lastTurnStatus: 'interrupted' }, kind: 'interrupted', label: 'Interrupted', svgClass: 'lucide-square' }
    ]

    for (const item of cases) {
      cleanup()
      const { container } = renderRow(item.overrides)
      const row = container.querySelector<HTMLElement>('[data-ui="sidebar-row"]')
      expect(row, item.name).toHaveAttribute('data-status', item.kind)
      expect(row?.querySelector('[data-ui="row-meta"]'), item.name).toHaveTextContent(item.label)
      const indicator = row?.querySelector<HTMLElement>('.thread-session-indicator')
      expect(indicator, item.name).toHaveAttribute('data-status', item.kind)
      expect(indicator, item.name).toHaveAttribute('aria-hidden', 'true')
      const svg = indicator?.querySelector('svg') ?? null
      if (item.svgClass === null) {
        expect(svg, item.name).toBeNull()
      } else {
        expect(svg, item.name).not.toBeNull()
        const cls = svg?.getAttribute('class') ?? ''
        expect(cls.split(/\s+/), item.name).toContain(item.svgClass)
      }
    }

    const css = readFileSync(CSS_PATH, 'utf8')
    expect(ruleBody(css, ".indicator[data-status='running']")).toContain('var(--intent-success-solid)')
    expect(ruleBody(css, ".indicator[data-status='running']::before")).toMatch(/width:\s*var\(--space-2\)/)
    expect(ruleBody(css, ".indicator[data-status='attention']")).toContain('var(--intent-warning-solid)')
    expect(ruleBody(css, ".indicator[data-status='failed']")).toContain('var(--intent-danger-solid)')
    expect(ruleBody(css, ".indicator[data-status='ready']")).toContain('var(--intent-info-solid)')

    // Edge variants: unread + pinned completed row, parallel child completed row, and pt-BR locale.
    cleanup()
    const unreadPinned = renderRow({ pinned: true }, { selected: true, unread: true })
    expect(unreadPinned.container.querySelector('.thread-unread-marker')).not.toBeNull()
    expect(unreadPinned.container.querySelector('.thread-session-indicator')).toHaveAttribute('data-status', 'completed')
    expect(unreadPinned.container.querySelector('.thread-session-indicator svg.lucide-check')).not.toBeNull()
    expect(unreadPinned.container.querySelector('[data-ui="row-meta"]')).toHaveTextContent('Finished')

    cleanup()
    const childRow = renderRow({ parentThreadId: 'parent-1' }, { child: true })
    expect(childRow.container.querySelector('[data-ui="sidebar-row"]')).toHaveAttribute('data-lines', '1')
    expect(childRow.container.querySelector('.thread-session-indicator')).toHaveAttribute('data-status', 'completed')
    const childSvg = childRow.container.querySelector<SVGSVGElement>('.thread-session-indicator svg.lucide-check')
    expect(childSvg).not.toBeNull()
    expect(Number(childSvg?.getAttribute('width'))).toBeLessThanOrEqual(12)

    cleanup()
    await changeLanguage('pt-BR')
    const ptBr = renderRow()
    expect(ptBr.container.querySelector('.thread-session-indicator')).toHaveAttribute('data-status', 'completed')
    expect(ptBr.container.querySelector('.thread-session-indicator svg.lucide-check')).not.toBeNull()
    expect(ptBr.container.querySelector('[data-ui="row-meta"]')).toHaveTextContent(i18n.t('thread:status.completed'))
  })

  it('A3: completed indicator uses canonical tokens only and satisfies WCAG AA contrast in light and dark modes', () => {
    const rowSource = readFileSync(ROW_PATH, 'utf8')
    expect(rowSource).not.toMatch(/\bCircleCheck\b/)

    const css = readFileSync(CSS_PATH, 'utf8')
    const tokensCss = readFileSync(TOKENS_CSS_PATH, 'utf8')
    const completedRule = ruleBody(css, ".indicator[data-status='completed']")
    expect(completedRule).not.toBe('')
    expect(completedRule).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/i)
    expect(completedRule).not.toContain('!important')

    const referencedTokens = [...completedRule.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)].map(match => match[1])
    expect(referencedTokens.length).toBeGreaterThanOrEqual(1)
    for (const token of referencedTokens) {
      expect(tokensCss, `${token} must be declared in tokens.generated.css`).toContain(`${token}:`)
    }

    const colorValue = /(?:^|;)\s*color\s*:\s*([^;]+)/.exec(completedRule)?.[1]?.trim() ?? ''
    expect(colorValue).not.toBe('')
    expect(colorValue).not.toContain('--intent-success-solid')

    const mixMatch = /^color-mix\(\s*in\s+srgb\s*,\s*var\(\s*(--[a-z0-9-]+)\s*\)\s+(\d+(?:\.\d+)?)%\s*,\s*var\(\s*(--[a-z0-9-]+)\s*\)\s*\)$/i.exec(colorValue)
    const directVar = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(colorValue)
    expect(Boolean(mixMatch || directVar), `completed color must be a canonical token or color-mix of canonical tokens: ${colorValue}`).toBe(true)

    for (const mode of ['light', 'dark'] as const) {
      const roles = colorRoles(mode)
      const resolvedHex = mixMatch
        ? over(resolveRoleHex(mixMatch[1], mode), Number(mixMatch[2]) / 100, resolveRoleHex(mixMatch[3], mode))
        : resolveRoleHex(directVar![1], mode)

      expect(resolvedHex, `${mode} completed color must differ from harsh intent-success-solid`).not.toBe(roles['intent-success-solid'])
      expect(contrast(resolvedHex, roles['surface-chrome']), `${mode} contrast on surface-chrome`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(resolvedHex, roles['fill-selected']), `${mode} contrast on fill-selected`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
