import { afterEach, describe, expect, it } from 'vitest'
import { buildStatusHeadline, describeSyncState, GITHUB_PANEL_TABS } from '../src/components/GitHub/githubPanelModel'
import { MCP_CATALOG } from '../src/components/MCP/connectorCatalog'
import { AGENT_STATE_LABEL } from '../src/components/MCP/mcpAgentStatus'
import { formatBytes } from '../src/components/Preview/BinaryPreview'
import { WORKBENCH_PANELS } from '../src/components/Workbench/panelCatalog'
import { TOOL_CATALOG } from '../src/components/Workspace/toolCatalog'
import { formatResetIn } from '../src/components/Workspace/UsageStatus'
import { WORKSPACE_DENSITIES } from '../src/components/Workspace/workspaceOptions'
import { relativeAge } from '../src/components/Worktree/WorktreeCleanupPanel'
import { changeLanguage } from '../src/i18n'
import { useEditorStore } from '../src/store/editor.store'
import { summarizeAgentSetup } from '../src/utils/agentSetup'
import { humanizeError } from '../src/utils/humanizeError'

afterEach(async () => { await changeLanguage('en') })

describe('Code mode in both languages', () => {
  it('names panels, tools and tabs in the language on screen, without keeping a stale copy', async () => {
    expect(WORKBENCH_PANELS.changes.label).toBe('Changes')
    expect(TOOL_CATALOG.find(tool => tool.id === 'github')?.label).toBe('Commit & pull request')
    expect(GITHUB_PANEL_TABS.find(tab => tab.id === 'settings')?.label).toBe('Settings')
    await changeLanguage('pt-BR')
    expect(WORKBENCH_PANELS.changes.label).toBe('Alterações')
    expect(TOOL_CATALOG.find(tool => tool.id === 'github')?.label).toBe('Commit e pull request')
    expect(TOOL_CATALOG.find(tool => tool.id === 'mcp')?.detail).toBe('Servidores e conectores que seus agentes usam')
    expect(GITHUB_PANEL_TABS.find(tab => tab.id === 'settings')?.label).toBe('Configurações')
    expect(WORKSPACE_DENSITIES.map(density => density.label)).toEqual(['Padrão do app', 'Compacta', 'Confortável'])
  })

  it('pluralizes Git sync words', async () => {
    expect(buildStatusHeadline({ ahead: 1, behind: 2, dirty: true, totalFiles: 1, hasRemote: true })).toBe('2 to pull · 1 to push · 1 file changed')
    expect(describeSyncState({ ahead: 1, behind: 0, dirty: false, hasRemote: true }).title).toBe('1 commit to push')
    await changeLanguage('pt-BR')
    expect(buildStatusHeadline({ ahead: 0, behind: 3, dirty: true, totalFiles: 2, hasRemote: true })).toBe('3 para baixar · 2 arquivos alterados')
    expect(describeSyncState({ ahead: 0, behind: 1, dirty: false, hasRemote: true }).title).toBe('1 commit para baixar')
    expect(buildStatusHeadline({ ahead: 0, behind: 0, dirty: false, totalFiles: 0, hasRemote: false })).toBe('Sem remoto · configure o origin para sincronizar')
  })

  it('formats sizes, ages and countdowns in the interface language', async () => {
    const now = Date.UTC(2026, 9, 28, 12)
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(relativeAge(now - 3 * 86_400_000, now)).toBe('idle for 3 days')
    expect(formatResetIn(now + 90 * 60_000, now)).toBe('1h 30m')
    await changeLanguage('pt-BR')
    expect(formatBytes(1536)).toBe('1,5 KB')
    expect(relativeAge(now - 86_400_000, now)).toBe('parado há 1 dia')
    expect(relativeAge(null, now)).toBe('atividade desconhecida')
    expect(formatResetIn(now + 90 * 60_000, now)).toBe('1 h 30 min')
  })

  it('reads connector descriptions and setup notes from the catalog', async () => {
    const github = MCP_CATALOG.find(entry => entry.id === 'github')!
    const git = MCP_CATALOG.find(entry => entry.id === 'git')!
    expect(github.description).toBe('Triage PRs, issues, CI, and publish flows')
    expect(github.configure).toMatch(/personal-access-tokens/)
    expect(git.configure).toBeUndefined()
    expect(MCP_CATALOG.every(entry => entry.description && !entry.description.startsWith('mcp.'))).toBe(true)
    await changeLanguage('pt-BR')
    expect(git.description).toBe('Operações no repositório local')
    expect(AGENT_STATE_LABEL.connected).toBe('Agente conectado')
  })

  it('explains errors and agent setup in Portuguese', async () => {
    await changeLanguage('pt-BR')
    expect(humanizeError(new Error('spawn gh ENOENT'))).toBe('gh não foi encontrado. Instale-o ou adicione-o ao PATH e tente de novo.')
    expect(humanizeError(undefined)).toBe('Algo deu errado. Tente de novo.')
    const ready = summarizeAgentSetup([{ provider: 'claude', command: 'claude', status: 'ready' }, { provider: 'codex', command: 'codex', status: 'ready' }], false)
    expect(ready.headline).toBe('Claude Code e Codex estão prontos')
  })
})

describe('editor store', () => {
  it('remembers the line a search match asked for, once per request', () => {
    useEditorStore.setState({ files: {}, tabs: {}, activePath: {}, reveal: {} })
    window.oxe = { fs: { readFile: async () => ({ relativePath: 'a.ts', content: 'x', size: 1, mtimeMs: 1 }), watchFile: async () => ({ watchId: 'w' }) } } as unknown as typeof window.oxe
    void useEditorStore.getState().openFile({ workspaceId: 'ws', rootPath: '/r', relativePath: 'a.ts', line: 7 })
    const first = useEditorStore.getState().reveal.ws!
    expect(first).toMatchObject({ relativePath: 'a.ts', line: 7 })
    void useEditorStore.getState().openFile({ workspaceId: 'ws', rootPath: '/r', relativePath: 'a.ts', line: 7 })
    expect(useEditorStore.getState().reveal.ws!.seq).toBe(first.seq + 1)
    useEditorStore.getState().clearReveal('ws', first.seq)
    expect(useEditorStore.getState().reveal.ws).not.toBeNull()
    useEditorStore.getState().clearReveal('ws', first.seq + 1)
    expect(useEditorStore.getState().reveal.ws).toBeNull()
  })

  it('resolves an on-disk conflict either way', () => {
    const file = { workspaceId: 'ws', rootPath: '/r', relativePath: 'a.ts', content: 'mine', lastSavedContent: 'base', language: 'ts', watchId: 'w', isLoading: false, isSaving: false, error: null, conflict: { externalContent: 'disk', externalMtimeMs: 2 } }
    useEditorStore.setState({ files: { ws: { 'a.ts': file } }, activePath: { ws: 'a.ts' } })
    useEditorStore.getState().resolveConflict('ws', 'mine')
    expect(useEditorStore.getState().files.ws['a.ts']).toMatchObject({ content: 'mine', lastSavedContent: 'disk', conflict: null })
    useEditorStore.setState({ files: { ws: { 'a.ts': file } } })
    useEditorStore.getState().resolveConflict('ws', 'disk')
    expect(useEditorStore.getState().files.ws['a.ts']).toMatchObject({ content: 'disk', lastSavedContent: 'disk', conflict: null })
  })
})
