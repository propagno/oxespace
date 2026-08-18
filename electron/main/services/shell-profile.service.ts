import type { AppDatabase } from '../db/index'
import type { ShellProfile } from '../../../shared/types/workspace'
import { builtinShellProfileIds } from './shell-profile.defaults'

interface ShellProfileRow {
  id: string
  name: string
  executable: string
  args_json: string
  is_builtin: number
}

export class ShellProfileService {
  constructor(
    private readonly db: AppDatabase,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  list(): ShellProfile[] {
    // The neutral builtin differs by platform (PowerShell vs bash), and the
    // other platform's row stays in the table after migration 046 — so the
    // picker filters by the host's set rather than a fixed id list.
    const ids = builtinShellProfileIds(this.platform)
    const rows = this.db
      .prepare(`
        SELECT id, name, executable, args_json, is_builtin
        FROM shell_profiles
        WHERE id IN (${ids.map(() => '?').join(', ')})
      `)
      .all(...ids) as ShellProfileRow[]

    const displayOrder = new Map(ids.map((id, index) => [id, index]))
    return rows
      .sort((a, b) => (displayOrder.get(a.id) ?? ids.length) - (displayOrder.get(b.id) ?? ids.length))
      .map(mapShellProfile)
  }

  get(id: string): ShellProfile | null {
    const row = this.db
      .prepare('SELECT id, name, executable, args_json, is_builtin FROM shell_profiles WHERE id = ?')
      .get(id) as ShellProfileRow | undefined

    return row ? mapShellProfile(row) : null
  }
}

function mapShellProfile(row: ShellProfileRow): ShellProfile {
  return {
    id: row.id,
    name: row.name,
    executable: row.executable,
    args: JSON.parse(row.args_json) as string[],
    isBuiltin: row.is_builtin === 1
  }
}
