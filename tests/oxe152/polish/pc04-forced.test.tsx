// Acceptance tests for OXE-251 (PC-04·1, CA-1..CA-3): active pane, active sidebar row and workspace header dot in forced colours.
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { PaneSessionRow } from '../../../src/components/Sidebar/PaneSessionRow'
import { useTerminalStore, type TerminalStateEntry } from '../../../src/store/terminal.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

interface CssRule {
  bare: string
  forced: boolean
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
  const walk = (block: string, forced: boolean, layered: boolean): void => {
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
        if (/^@layer\b/.test(head)) walk(body, forced, true)
        else if (/^@media\b/.test(head) && /forced-colors:\s*active/.test(head)) walk(body, true, layered)
        else if (/^@(container|supports)\b/.test(head)) walk(body, forced, layered)
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
        rules.push({ bare: raw, forced, layered, spec: specificity(raw), order: orderCounter++, decls })
      }
    }
  }
  walk(read(rel).replace(/\/\*[\s\S]*?\*\//g, ''), false, false)
  return rules
}

const RULES: CssRule[] = [
  ...parseCss('src/styles/features/pane.css'),
  ...parseCss('src/components/Workspace/CodeChrome.css'),
  ...parseCss('src/styles/forced-colors.css')
]

function cssValue(node: Element, props: string | string[], forced = true): string | undefined {
  const names = Array.isArray(props) ? props : [props]
  const hits: Array<{ value: string; important: boolean; layered: boolean; spec: number; order: number }> = []
  for (const rule of RULES) {
    if (rule.forced && !forced) continue
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

const paneA = { id: 'p-1', workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 0, status: 'running', agentProfileId: null, agentName: null, displayName: 'Terminal 1', rootPath: null } as unknown as WorkspacePane
const paneB = { id: 'p-2', workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 1, status: 'running', agentProfileId: null, agentName: null, displayName: 'Terminal 2', rootPath: null } as unknown as WorkspacePane
const workspace = { id: 'ws-1', name: 'demo', rootPath: 'C:/dev/demo', panes: [paneA, paneB] } as unknown as Workspace
const running = { status: 'running', error: null, lastActivityAt: null, lastOutput: null, lastIntent: null, lastIntentAt: null, isWorking: false, hasUnread: false, hookState: null, hookAt: null, agentState: null, agentSource: null, location: null, detached: false } as unknown as TerminalStateEntry

beforeEach(() => {
  useWorkspaceStore.setState({ workspaces: [workspace] })
  useTerminalStore.setState({ panes: { 'p-1': running, 'p-2': running }, activePaneId: 'p-2' })
})

afterEach(() => cleanup())

describe('PC-04·1 · active pane, active row and workspace dot in forced colours (OXE-251)', () => {
  test('[css] in forced colours the active pane has a 2 px Highlight outline', () => {
    const { container } = render(
      <>
        <div className="pane-container" data-testid="inactive-pane" />
        <div className="pane-container active" data-testid="active-pane" />
      </>
    )
    const active = container.querySelector('[data-testid="active-pane"]')!
    const inactive = container.querySelector('[data-testid="inactive-pane"]')!
    expect(cssValue(active, 'outline', true)).toBe('2px solid Highlight')
    expect(cssValue(inactive, 'outline', true)).toBeUndefined()
  })

  test('the active pane row has aria-current and, in forced colours, Highlight with HighlightText', () => {
    render(
      <>
        <PaneSessionRow pane={paneA} paneIndex={0} workspace={workspace} isActive={false} agentProfiles={[]} onClick={() => {}} onActivatePane={() => {}} />
        <PaneSessionRow pane={paneB} paneIndex={1} workspace={workspace} isActive={true} agentProfiles={[]} onClick={() => {}} onActivatePane={() => {}} />
      </>
    )
    const rows = screen.getAllByTestId('pane-session-row')
    const inactiveRow = rows[0]
    const activeRow = rows[1]

    expect(inactiveRow).not.toHaveAttribute('aria-current')
    expect(activeRow.getAttribute('aria-current')).toMatch(/^(true|page)$/)
    expect(cssValue(activeRow, 'forced-color-adjust', true)).toBe('none')
    expect(cssValue(activeRow, ['background', 'background-color'], true)).toBe('Highlight')
    expect(cssValue(activeRow, 'color', true)).toBe('HighlightText')
    expect(cssValue(inactiveRow, ['background', 'background-color'], true)).not.toBe('Highlight')
  })

  test('[css] in forced colours the workspace colour dot in the header has a 1 px CanvasText outline', () => {
    const { container } = render(
      <div className="workspace-topbar">
        <span className="workspace-topbar-wsdot" data-testid="ws-dot" aria-hidden="true" />
      </div>
    )
    const dot = container.querySelector('[data-testid="ws-dot"]')!
    expect(cssValue(dot, 'forced-color-adjust', true)).toBe('none')
    expect(cssValue(dot, 'outline', true)).toBe('1px solid CanvasText')
  })
})
