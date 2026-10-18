/**
 * Approval store for oxe.yaml hook scripts. A hook runs only when the exact
 * script text on disk was approved for that repository; anything else —
 * never approved, or edited since — fails closed.
 */
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { AppDatabase } from '../../db'
import type { RepoHookKind } from '../../../../shared/types/repo-config'

export function hashHookScript(script: string): string {
  return createHash('sha256').update(script.trim()).digest('hex')
}

/**
 * Git reports `C:/x/repo` while the app stores `C:\x\repo`; both must name the
 * same repository or an approval would silently not apply.
 */
export function trustKey(rootPath: string): string {
  const normalized = resolve(rootPath).replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export class RepoHookTrust {
  constructor(private readonly db: AppDatabase, private readonly now: () => number = Date.now) {}

  isTrusted(rootPath: string, kind: RepoHookKind, script: string): boolean {
    const row = this.db
      .prepare('SELECT content_hash FROM repo_hook_trust WHERE root_path = ? AND kind = ?')
      .get(trustKey(rootPath), kind) as { content_hash: string } | undefined
    return row?.content_hash === hashHookScript(script)
  }

  approve(rootPath: string, kind: RepoHookKind, script: string): void {
    this.db
      .prepare(
        `INSERT INTO repo_hook_trust (root_path, kind, content_hash, approved_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(root_path, kind) DO UPDATE SET content_hash = excluded.content_hash, approved_at = excluded.approved_at`
      )
      .run(trustKey(rootPath), kind, hashHookScript(script), this.now())
  }

  revoke(rootPath: string, kind: RepoHookKind): void {
    this.db.prepare('DELETE FROM repo_hook_trust WHERE root_path = ? AND kind = ?').run(trustKey(rootPath), kind)
  }
}
