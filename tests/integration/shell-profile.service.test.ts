import { describe, expect, test } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { ShellProfileService } from '../../electron/main/services/shell-profile.service'
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
      )
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
    expect(builtinShellProfileIds('win32')).toEqual(['builtin-powershell', 'builtin-claude', 'builtin-copilot'])
    expect(builtinShellProfileIds('linux')).toEqual(['builtin-bash', 'builtin-claude', 'builtin-copilot'])
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
