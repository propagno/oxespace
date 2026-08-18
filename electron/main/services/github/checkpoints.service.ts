/**
 * Local checkpoints and the connected-repository list. The only collaborator
 * that owns SQLite state — which is why it is the only one taking a database.
 */
import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../../db/index'
import type { CheckpointRow, ConnectedRepositoryRow } from './rows'
import type {
  GitHubCheckpoint,
  GitHubConnectRepositoryInput,
  GitHubConnectedRepository,
  GitHubCreateCheckpointInput,
  GitHubMessageResult,
  GitHubRestoreCheckpointInput,
  GitHubWorkspaceInput
} from '../../../../shared/types/github'
import { mapCheckpoint, mapConnectedRepository, ok } from './parsers'
import type { GhExec } from './gh-exec'
export class GitHubCheckpointService {
  constructor(private readonly db: AppDatabase, private readonly gh: GhExec) {}
  listCheckpoints(input: GitHubWorkspaceInput): GitHubCheckpoint[] {
    const rows = this.db.prepare('SELECT * FROM github_checkpoints WHERE workspace_id = ? ORDER BY created_at DESC').all(input.workspaceId) as CheckpointRow[]
    return rows.map(mapCheckpoint)
  }

  async createCheckpoint(input: GitHubCreateCheckpointInput): Promise<GitHubCheckpoint> {
    const [branchRaw, baseCommitRaw, patch, untrackedRaw] = await Promise.all([
      this.gh.tryGit(['branch', '--show-current'], input.rootPath),
      this.gh.tryGit(['rev-parse', 'HEAD'], input.rootPath),
      this.gh.tryGit(['diff', 'HEAD', '--binary'], input.rootPath),
      this.gh.tryGit(['ls-files', '--others', '--exclude-standard'], input.rootPath)
    ])
    const branch = branchRaw.trim() || null
    const baseCommit = baseCommitRaw.trim() || null
    const untrackedFiles = untrackedRaw.split('\n').filter(Boolean)
    const id = randomUUID()
    const createdAt = this.gh.now()

    this.db.prepare(`
      INSERT INTO github_checkpoints (id, workspace_id, name, description, branch, base_commit, patch, untracked_files, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.workspaceId, input.name, input.description ?? null, branch, baseCommit, patch, JSON.stringify(untrackedFiles), createdAt)

    return {
      id,
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description ?? null,
      branch,
      baseCommit,
      patch,
      untrackedFiles,
      createdAt
    }
  }

  async restoreCheckpoint(input: GitHubRestoreCheckpointInput): Promise<GitHubMessageResult> {
    const row = this.db.prepare('SELECT * FROM github_checkpoints WHERE id = ? AND workspace_id = ?').get(input.checkpointId, input.workspaceId) as CheckpointRow | undefined
    if (!row) throw new Error('Checkpoint não encontrado.')
    if (await this.gh.hasWorkingTreeChanges(input.rootPath)) {
      throw new Error('Restore bloqueado: working tree possui mudanças. Faça commit/stash ou limpe o workspace antes.')
    }
    if (row.patch.trim()) await this.gh.runGit(['apply', '--whitespace=nowarn', '-'], input.rootPath, row.patch)
    return ok('Checkpoint restaurado para arquivos rastreados.')
  }

  deleteCheckpoint(input: { checkpointId: string }): GitHubMessageResult {
    this.db.prepare('DELETE FROM github_checkpoints WHERE id = ?').run(input.checkpointId)
    return ok('Checkpoint removido.')
  }

  listConnectedRepositories(input: GitHubWorkspaceInput): GitHubConnectedRepository[] {
    const rows = this.db.prepare('SELECT * FROM github_connected_repositories WHERE workspace_id = ? ORDER BY created_at DESC').all(input.workspaceId) as ConnectedRepositoryRow[]
    return rows.map(mapConnectedRepository)
  }

  connectRepository(input: GitHubConnectRepositoryInput): GitHubConnectedRepository {
    const id = randomUUID()
    const createdAt = this.gh.now()
    this.db.prepare(`
      INSERT INTO github_connected_repositories (id, workspace_id, full_name, url, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, full_name) DO UPDATE SET url = excluded.url
    `).run(id, input.workspaceId, input.fullName, input.url ?? null, createdAt)
    const row = this.db.prepare('SELECT * FROM github_connected_repositories WHERE workspace_id = ? AND full_name = ?').get(input.workspaceId, input.fullName) as ConnectedRepositoryRow
    return mapConnectedRepository(row)
  }
}