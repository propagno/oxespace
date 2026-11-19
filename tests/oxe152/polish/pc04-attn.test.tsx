// Acceptance tests for OXE-252 (PC-04·2, CA-1 and CA-2): needs-decision in OxeCode uses --attn tokens, StatusSignal and --control-sm, with no Hand icon.
import { cleanup, render, within } from '@testing-library/react'
import { Hand } from 'lucide-react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { PaneContainer } from '../../../src/components/Grid/PaneContainer'
import { PaneSessionRow } from '../../../src/components/Sidebar/PaneSessionRow'
import { useTerminalStore, type TerminalStateEntry } from '../../../src/store/terminal.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'

vi.mock('../../../src/components/Panes/PaneContent', () => ({
  PaneContent: () => <div data-testid="mock-pane-content" />
}))

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

interface CssRule {
  bare: string
  layered: boolean
  spec: number
  order: number
  decls: Array<[string, string, boolean]>
}

const STATE_RE = /:(hover|focus-visible|focus-within|focus)(?![\w-])/g

function splitTop(text: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === sep && depth === 0) {
      out.push(text.slice(start, i))
      start = i + 1
    }
  }
  out.push(text.slice(start))
  return out.map(s => s.trim()).filter(Boolean)
}

function specificity(selector: string): number {
  const s = selector.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '')
  const ids = (s.match(/#[\w-]+/g) ?? []).length
  const cls = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!not\(|is\(|has\(|where\()[\w-]+/g) ?? []).length
  const types = (s.match(/(^|[\s>+~(,])[a-zA-Z][\w-]*/g) ?? []).length
  return ids * 10000 + cls * 100 + types
}

let orderCounter = 0
function parseCss(rel: string): CssRule[] {
  const rules: CssRule[] = []
  const walk = (block: string, layered: boolean): void => {
    let i = 0
    while (i < block.length) {
      const open = block.indexOf('{', i)
      const semi = block.indexOf(';', i)
      if (open === -1) return
      if (semi !== -1 && semi < open && block.slice(i, semi).trim().startsWith('@')) {
        i = semi + 1
        continue
      }
      let depth = 1
      let close = open + 1
      for (; close < block.length && depth > 0; close++) {
        if (block[close] === '{') depth++
        else if (block[close] === '}') depth--
      }
      const head = block.slice(i, open).trim()
      const body = block.slice(open + 1, close - 1)
      i = close
      if (head.startsWith('@')) {
        if (/^@layer\b/.test(head)) walk(body, true)
        continue
      }
      const decls = splitTop(body, ';')
        .map(item => {
          const colon = item.indexOf(':')
          if (colon < 0) return ['', '', false] as [string, string, boolean]
          const value = item.slice(colon + 1).trim()
          return [item.slice(0, colon).trim().toLowerCase(), value.replace(/\s*!important$/, ''), /!important$/.test(value)] as [string, string, boolean]
        })
        .filter(([name]) => Boolean(name))
      for (const raw of splitTop(head, ',')) {
        if (raw.includes('::') || STATE_RE.test(raw)) {
          STATE_RE.lastIndex = 0
          continue
        }
        STATE_RE.lastIndex = 0
        rules.push({ bare: raw, layered, spec: specificity(raw), order: orderCounter++, decls })
      }
    }
  }
  walk(read(rel).replace(/\/\*[\s\S]*?\*\//g, ''), false)
  return rules
}

const RULES: CssRule[] = [
  ...parseCss('src/styles/layout.css'),
  ...parseCss('src/styles/features/pane.css'),
  ...parseCss('src/styles/features/status.css')
]

function cssValue(node: Element, props: string | string[]): string | undefined {
  const names = Array.isArray(props) ? props : [props]
  const hits: Array<{ value: string; important: boolean; layered: boolean; spec: number; order: number }> = []
  for (const rule of RULES) {
    let ok = false
    try {
      ok = node.matches(rule.bare)
    } catch {
      ok = false
    }
    if (!ok) continue
    for (const [name, value, important] of rule.decls) {
      if (names.includes(name)) hits.push({ value, important, layered: rule.layered, spec: rule.spec, order: rule.order })
    }
  }
  hits.sort((a, b) => Number(a.important) - Number(b.important) || Number(b.layered) - Number(a.layered) || a.spec - b.spec || a.order - b.order)
  return hits.at(-1)?.value
}

function svgSignature(svg: Element | null): string {
  if (!svg) return ''
  return [...svg.querySelectorAll('path,circle,rect,line,polyline,polygon')].map(el => el.getAttribute('d') ?? el.tagName).join('|')
}

const HAND_PATH = (() => {
  const div = document.createElement('div')
  div.innerHTML = renderToStaticMarkup(<Hand />)
  return svgSignature(div.querySelector('svg'))
})()

const pane = { id: 'p-dec', workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 0, status: 'running', agentProfileId: null, agentName: 'Claude', displayName: null, rootPath: null } as unknown as WorkspacePane
const workspace = { id: 'ws-1', name: 'demo', rootPath: 'C:/dev/demo', panes: [pane] } as unknown as Workspace
const blockedEntry = { status: 'running', error: null, lastActivityAt: null, lastOutput: null, lastIntent: null, lastIntentAt: null, isWorking: false, hasUnread: false, hookState: 'waiting', hookAt: Date.now(), agentState: 'blocked', agentSource: 'hook', location: null, detached: false } as unknown as TerminalStateEntry

beforeEach(() => {
  useWorkspaceStore.setState({ workspaces: [workspace] })
  useTerminalStore.setState({ panes: { 'p-dec': blockedEntry }, activePaneId: 'p-dec' })
})

afterEach(() => cleanup())

describe('PC-04·2 · needs-decision uses --attn tokens and StatusSignal (OXE-252)', () => {
  test('[css] a pane in needs-decision shows the needs-you StatusSignal and the --attn tokens on its dot, chip and row preview, with no Hand icon', () => {
    const { container } = render(
      <>
        <PaneSessionRow pane={pane} paneIndex={0} workspace={workspace} isActive={false} agentProfiles={[]} onClick={() => {}} onActivatePane={() => {}} />
        <PaneContainer pane={pane} workspace={workspace} agentProfile={null} autoStart={false} isMaximized={false} onToggleMaximize={() => {}} />
        <span className="sidebar-rail-pip activity-needs-decision" data-testid="rail-pip" />
      </>
    )

    const row = container.querySelector('[data-testid="pane-session-row"]')!
    const dot = container.querySelector('[data-testid="pane-status-dot"]')!
    const chip = container.querySelector('[data-testid="pane-decision-chip"]')!
    const preview = within(row as HTMLElement).getByTestId('pane-row-status')
    const railPip = container.querySelector('[data-testid="rail-pip"]')!

    // StatusSignal state="needs-you" present in both row and chip
    expect(row.querySelector('[data-ui="status-signal"][data-state="needs-you"]')).not.toBeNull()
    expect(chip.querySelector('[data-ui="status-signal"][data-state="needs-you"]')).not.toBeNull()

    // No Hand icon rendered anywhere in row or pane container
    for (const svg of container.querySelectorAll('svg')) {
      expect(svgSignature(svg)).not.toBe(HAND_PATH)
    }

    // --attn tokens on dot, chip, row preview, and collapsed rail pip
    expect(cssValue(dot, 'border')).toContain('var(--attn)')
    expect(cssValue(dot, 'background')).toBe('var(--attn-bg)')
    expect(cssValue(chip, 'border')).toContain('var(--attn-border)')
    expect(cssValue(chip, 'background')).toBe('var(--attn-bg)')
    expect(cssValue(chip, 'color')).toBe('var(--attn-fg)')
    expect(cssValue(preview, 'color')).toBe('var(--attn-fg)')
    expect(cssValue(railPip, 'background')).toBe('var(--attn-bg)')
    expect(cssValue(railPip, 'border')).toContain('var(--attn)')
  })

  test('[css] the interactive decision chip has min-height --control-sm', () => {
    const { container } = render(
      <PaneContainer pane={pane} workspace={workspace} agentProfile={null} autoStart={false} isMaximized={false} onToggleMaximize={() => {}} />
    )
    const chip = container.querySelector('[data-testid="pane-decision-chip"]')!
    expect(cssValue(chip, 'min-height')).toBe('var(--control-sm)')
    expect(cssValue(chip, 'height')).toBeUndefined()
  })
})
