import type { AppDatabase } from '../db/index'
import type { ShellProfile } from '../../../shared/types/workspace'

interface ShellProfileRow {
  id: string
  name: string
  executable: string
  args_json: string
  is_builtin: number
}

export class ShellProfileService {
  constructor(private readonly db: AppDatabase) {}

  list(): ShellProfile[] {
    const rows = this.db
      .prepare('SELECT id, name, executable, args_json, is_builtin FROM shell_profiles ORDER BY is_builtin DESC, name ASC')
      .all() as ShellProfileRow[]

    return rows.map(mapShellProfile)
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
