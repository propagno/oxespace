/** Shapes of the two SQLite tables this feature owns. */

export interface CheckpointRow {
  id: string
  workspace_id: string
  name: string
  description: string | null
  branch: string | null
  base_commit: string | null
  patch: string
  untracked_files: string
  created_at: number
}

export interface ConnectedRepositoryRow {
  id: string
  workspace_id: string
  full_name: string
  url: string | null
  created_at: number
}
