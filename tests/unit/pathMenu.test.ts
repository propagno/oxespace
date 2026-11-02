import { describe, expect, it } from 'vitest'
import { pathMenuEntries } from '../../src/lib/pathMenu'
import { conversationPathMenu } from '../../src/components/PathMenu/conversationPathMenu'

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
  it('gives project and worktree files the full menu at their own checkout, and others none', () => {
    expect(conversationPathMenu('/repo/src/a.ts', 'ws', '/repo', ['/wt'])).toEqual({ request: { workspaceId: 'ws', rootPath: '/repo', relativePath: 'src/a.ts' }, copyOnly: false })
    expect(conversationPathMenu('/wt/src/a.ts', 'ws', '/repo', ['/wt'])).toEqual({ request: { workspaceId: 'ws', rootPath: '/wt', relativePath: 'src/a.ts' }, copyOnly: false })
    expect(conversationPathMenu('/elsewhere/a.ts', 'ws', '/repo', ['/wt'])).toBeNull()
    expect(conversationPathMenu('/repo/src/a.ts', undefined, '/repo', [])).toBeNull()
  })
})
