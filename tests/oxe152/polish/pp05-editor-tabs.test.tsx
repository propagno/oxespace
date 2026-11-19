// Acceptance test for 1.5.2 Polimento · OxeCode painéis (Jira OXE-261, PP-05·4, CA-1 to CA-3).
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { EditorTabs } from '../../../src/components/Editor/EditorTabs'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

interface CssRule {
  selector: string
  decls: Record<string, string>
}

function parseRules(css: string): CssRule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: CssRule[] = []
  let i = 0
  while (i < clean.length) {
    const open = clean.indexOf('{', i)
    if (open === -1) break
    let depth = 1
    let close = open + 1
    for (; close < clean.length && depth > 0; close++) {
      if (clean[close] === '{') depth++
      else if (clean[close] === '}') depth--
    }
    const head = clean.slice(i, open).trim()
    const body = clean.slice(open + 1, close - 1)
    i = close
    if (head.startsWith('@')) continue
    const decls: Record<string, string> = {}
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      const prop = part.slice(0, colon).trim().toLowerCase()
      const val = part.slice(colon + 1).trim()
      if (prop) decls[prop] = val
    }
    for (const sel of head.split(',').map((s) => s.trim()).filter(Boolean)) {
      rules.push({ selector: sel, decls })
    }
  }
  return rules
}

afterEach(cleanup)

describe('OXE-261 · PP-05·4 Editor tabs close target, sentence case and density heights', () => {
  test('[css] .editor-tab-close has a 24 px var(--control-sm) target and is visible on hover and focus', () => {
    const onClose = vi.fn()
    render(
      <EditorTabs
        tabs={[
          { relativePath: 'src/index.ts', pinned: false },
          { relativePath: 'README.md', pinned: false }
        ]}
        activePath="src/index.ts"
        dirtyPaths={new Set()}
        onActivate={vi.fn()}
        onClose={onClose}
        onCloseOthers={vi.fn()}
        onCloseAll={vi.fn()}
        onTogglePin={vi.fn()}
        onMove={vi.fn()}
      />
    )

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    const closeEl = tabs[0].querySelector('.editor-tab-close')
    expect(closeEl).not.toBeNull()
    expect(closeEl?.getAttribute('aria-hidden')).toBe('true')
    expect(closeEl?.tagName).toBe('SPAN')

    fireEvent.keyDown(tabs[0], { key: 'Delete' })
    expect(onClose).toHaveBeenCalledWith('src/index.ts')

    const rules = parseRules(read('src/styles/preview.css'))
    const baseClose = rules.find((r) => r.selector === '.editor-tab-close')
    expect(baseClose).toBeDefined()
    expect(baseClose?.decls.width).toBe('var(--control-sm)')
    expect(baseClose?.decls.height).toBe('var(--control-sm)')

    const hoverRule = rules.find((r) => r.selector === '.editor-tab:hover .editor-tab-close')
    const focusWithinRule = rules.find((r) => r.selector === '.editor-tab:focus-within .editor-tab-close')
    expect(Number(hoverRule?.decls.opacity)).toBeGreaterThan(0)
    expect(Number(focusWithinRule?.decls.opacity)).toBeGreaterThan(0)
  })

  test('[css] .editor-sidebar-title and .editor-dirty use sentence case --fs-xs and --intent-warning tokens with no rgba shadow', () => {
    const rules = parseRules(read('src/styles/features/editor.css'))

    const sidebarTitle = rules.find((r) => r.selector === '.editor-sidebar-title')
    expect(sidebarTitle).toBeDefined()
    expect(sidebarTitle?.decls['font-size']).toBe('var(--fs-xs)')
    expect(sidebarTitle?.decls['text-transform']).not.toBe('uppercase')

    const dirty = rules.find((r) => r.selector === '.editor-dirty')
    expect(dirty).toBeDefined()
    expect(dirty?.decls['font-size']).toBe('var(--fs-xs)')
    expect(dirty?.decls['text-transform']).not.toBe('uppercase')

    const dirtyActive = rules.find((r) => r.selector === '.editor-dirty.active')
    expect(dirtyActive).toBeDefined()
    expect(dirtyActive?.decls.background).toBe('var(--intent-warning-bg)')
    expect(dirtyActive?.decls['border-color']).toBe('var(--intent-warning-border)')
    expect(dirtyActive?.decls.color).toBe('var(--intent-warning-fg)')
    expect(dirtyActive?.decls['box-shadow']).toBeUndefined()
  })

  test('[css] .editor-toolbar uses --bar-md and .editor-browser-file uses --row-1', () => {
    const rules = parseRules(read('src/styles/features/editor.css'))

    const toolbar = rules.find((r) => r.selector === '.editor-toolbar')
    expect(toolbar).toBeDefined()
    expect(toolbar?.decls.height).toBe('var(--bar-md)')

    const browserFile = rules.find((r) => r.selector === '.editor-browser-file')
    expect(browserFile).toBeDefined()
    expect(browserFile?.decls.height).toBe('var(--row-1)')
  })
})
