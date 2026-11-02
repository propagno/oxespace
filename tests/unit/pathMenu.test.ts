import { describe, expect, it } from 'vitest'
import { pathMenuEntries } from '../../src/lib/pathMenu'
import { conversationPathMenu } from '../../src/components/PathMenu/usePathMenu'

const request = { workspaceId: 'ws', rootPath: '/repo', relativePath: 'src/app.ts', line: 4 }
const targets = { editors: [{ id: 'vscode' as const, name: 'VS Code' }, { id: 'zed' as const, name: 'Zed' }], preferred: 'zed' as const }
const shape = (entries: ReturnType<typeof pathMenuEntries>) => entries.map(entry => entry.type === 'separator' ? '—' : 'label' in entry ? entry.label : '?')

describe('pathMenuEntries (F33 §4)', () => {
  it('keeps the fixed order, with the preferred editor first', () => {
    const items = shape(pathMenuEntries({ request, targets, platform: 'win32', openInOxespace: () => undefined }))
    expect(items[0]).toMatch(/OXESpace/)
    expect(items[1]).toBe('—')
    expect(items[2]).toMatch(/Zed.*4/)
    expect(items[3]).toMatch(/VS Code.*4/)
    expect(items.slice(4, 6)).toEqual(['—', items[5]])
    expect(items.slice(-3)).toEqual(['—', items.at(-2), items.at(-1)])
    expect(items.filter(item => item === '—')).toHaveLength(3)
  })

  it('shows the Ctrl+Shift+click hint only where that click works (the terminal)', () => {
    const plain = pathMenuEntries({ request, targets, platform: 'linux' })
    const terminal = pathMenuEntries({ request, targets, platform: 'linux', externalClickHint: true })
    expect(plain.some(entry => 'shortcut' in entry && entry.shortcut)).toBe(false)
    expect(terminal.filter(entry => 'shortcut' in entry && entry.shortcut)).toHaveLength(1)
  })

  it('leaves no group and no separator for missing editors, a folder, or a copy-only file', () => {
    const none = shape(pathMenuEntries({ request, targets: { editors: [], preferred: 'auto' }, platform: 'linux' }))
    expect(none.filter(item => item === '—')).toHaveLength(1)
    const folder = shape(pathMenuEntries({ request, targets, platform: 'linux', folder: true }))
    expect(folder.some(item => /VS Code|Zed/.test(item))).toBe(false)
    const copyOnly = shape(pathMenuEntries({ request, targets, platform: 'linux', openInOxespace: () => undefined, copyOnly: true }))
    expect(copyOnly).toHaveLength(2)
    expect(copyOnly.includes('—')).toBe(false)
  })
})

describe('conversationPathMenu', () => {
  it('gives the conversation project files the full menu, worktree files copy only, and others none', () => {
    expect(conversationPathMenu('/repo/src/a.ts', 'ws', '/repo', ['/wt'])).toEqual({ request: { workspaceId: 'ws', rootPath: '/repo', relativePath: 'src/a.ts' }, copyOnly: false })
    expect(conversationPathMenu('/wt/src/a.ts', 'ws', '/repo', ['/wt'])).toEqual({ request: { workspaceId: 'ws', rootPath: '/wt', relativePath: 'src/a.ts' }, copyOnly: true })
    expect(conversationPathMenu('/elsewhere/a.ts', 'ws', '/repo', ['/wt'])).toBeNull()
    expect(conversationPathMenu('/repo/src/a.ts', undefined, '/repo', [])).toBeNull()
  })
})
