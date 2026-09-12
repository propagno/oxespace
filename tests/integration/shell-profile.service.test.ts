import { describe, expect, test } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { ShellProfileService } from '../../electron/main/services/shell-profile.service'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import {
  builtinShellProfileIds,
  defaultSplitShellProfileId,
  fallbackShellProfiles
} from '../../electron/main/services/shell-profile.defaults'

// The neutral built-in shell is PowerShell on Windows and bash elsewhere
// (migration 046). The in-memory DB runs the host's variant, so the expected
// row follows the host too.
const IS_WINDOWS = process.platform === 'win32'

describe('ShellProfileService', () => {
  test('expanded profiles save as defaults without changing running terminals', () => {
    const db = openInMemoryDatabase()
    try {
      const service = new WorkspaceService(db)
      const ws = service.create({ rootPath: process.cwd(), layout: '2x2', autoStart: false })
      db.prepare("UPDATE panes SET status='running' WHERE id=?").run(ws.panes[0].id)
      db.prepare("UPDATE panes SET status='exited' WHERE id=?").run(ws.panes[1].id)
      const updated = service.updateSettings({ workspaceId: ws.id, defaultShellProfileId: 'builtin-codex', applyShellToIdlePanes: true })
      expect(updated.defaultShellProfileId).toBe('builtin-codex')
      expect(updated.panes.find(p => p.id === ws.panes[0].id)?.shellProfileId).toBe(ws.panes[0].shellProfileId)
      expect(updated.panes.filter(p => p.id !== ws.panes[0].id).every(p => p.shellProfileId === 'builtin-codex')).toBe(true)
    } finally { db.close() }
  })
  test('lists the host platform built-in shell profiles with parsed args', () => {
    const db = openInMemoryDatabase()
    const service = new ShellProfileService(db)

    const profiles = service.list()

    expect(profiles).toEqual([
      expect.objectContaining(
        IS_WINDOWS
          ? { id: 'builtin-powershell', name: 'PowerShell', executable: 'powershell.exe', args: ['-NoLogo'] }
          : { id: 'builtin-bash', name: 'Bash', executable: '/bin/bash', args: ['-l'] }
      ),
      expect.objectContaining({ id: 'builtin-claude', name: 'claude', executable: 'claude', args: [] }),
      expect.objectContaining(
        IS_WINDOWS
          ? { id: 'builtin-copilot', name: 'copilot shell', executable: 'powershell.exe', args: ['-NoLogo'] }
          : { id: 'builtin-copilot', name: 'copilot shell', executable: '/bin/bash', args: [] }
      ),
      expect.objectContaining({ id: 'builtin-codex', executable: 'codex' }),
      expect.objectContaining({ id: 'builtin-cursor', executable: 'cursor-agent' }),
      expect.objectContaining({ id: 'builtin-antigravity', executable: 'agy' }),
      expect.objectContaining({ id: 'builtin-grok', executable: 'grok' })
    ])

    db.close()
  })

  test('never offers the other platform neutral shell', () => {
    // Migration 046 keeps the unused row so foreign keys stay valid; the picker
    // must still hide it, otherwise Linux users see a PowerShell entry that
    // cannot spawn (and vice versa).
    const db = openInMemoryDatabase()
    const ids = new ShellProfileService(db).list().map((profile) => profile.id)

    expect(ids).not.toContain(IS_WINDOWS ? 'builtin-bash' : 'builtin-powershell')

    db.close()
  })
})

describe('shell profile defaults', () => {
  test('resolves the neutral built-in shell per platform', () => {
    expect(defaultSplitShellProfileId('win32')).toBe('builtin-powershell')
    expect(defaultSplitShellProfileId('linux')).toBe('builtin-bash')
    expect(defaultSplitShellProfileId('darwin')).toBe('builtin-bash')
  })

  test('lists the neutral shell first, then the agent profiles', () => {
    const agents = ['builtin-claude', 'builtin-copilot', 'builtin-codex', 'builtin-cursor', 'builtin-antigravity', 'builtin-grok']
    expect(builtinShellProfileIds('win32')).toEqual(['builtin-powershell', ...agents])
    expect(builtinShellProfileIds('linux')).toEqual(['builtin-bash', ...agents])
  })

  test('DB-less fallbacks mirror what the migrations seed', () => {
    expect(fallbackShellProfiles('win32')[0]).toEqual(
      expect.objectContaining({ id: 'builtin-powershell', executable: 'powershell.exe', args: ['-NoLogo'] })
    )
    expect(fallbackShellProfiles('linux')[0]).toEqual(
      expect.objectContaining({ id: 'builtin-bash', executable: '/bin/bash', args: ['-l'] })
    )
  })
})
