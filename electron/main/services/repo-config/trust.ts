/**
 * Approval store for oxe.yaml hook scripts and sensitive worktree copy patterns.
 * A hook or sensitive copy runs only when the exact content/pattern set on disk
 * was approved for the canonical primary repository root; anything else —
 * never approved, or edited since — fails closed.
 */
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { AppDatabase } from '../../db'
import type { RepoHookKind, RepoTrustKind } from '../../../../shared/types/repo-config'

export function hashHookScript(script: string): string {
  return createHash('sha256').update(script.trim()).digest('hex')
}

/**
 * Deterministic SHA-256 fingerprint for a set of sensitive copy patterns.
 * Normalized, deduplicated and sorted so reordering non-conflicting entries
 * does not spuriously invalidate an approval, while adding/editing any sensitive
 * pattern invalidates trust immediately.
 */
export function hashSensitivePatterns(patterns: readonly string[]): string {
  const canonical = [...new Set(patterns.map((p) => p.trim().replace(/\\/g, '/')).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .join('\n')
  return createHash('sha256').update(`sensitive-copy:v1\n${canonical}`).digest('hex')
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
    this.upsertHash(rootPath, kind, hashHookScript(script))
  }

  revoke(rootPath: string, kind: RepoTrustKind): void {
    this.db.prepare('DELETE FROM repo_hook_trust WHERE root_path = ? AND kind = ?').run(trustKey(rootPath), kind)
  }

  isSensitiveCopyTrusted(rootPath: string, patterns: readonly string[]): boolean {
    if (patterns.length === 0) return true
    const row = this.db
      .prepare('SELECT content_hash FROM repo_hook_trust WHERE root_path = ? AND kind = ?')
      .get(trustKey(rootPath), 'sensitive-copy') as { content_hash: string } | undefined
    return row?.content_hash === hashSensitivePatterns(patterns)
  }

  approveSensitiveCopy(rootPath: string, patterns: readonly string[]): void {
    if (patterns.length === 0) return
    this.upsertHash(rootPath, 'sensitive-copy', hashSensitivePatterns(patterns))
  }

  revokeSensitiveCopy(rootPath: string): void {
    this.revoke(rootPath, 'sensitive-copy')
  }

  private upsertHash(rootPath: string, kind: RepoTrustKind, contentHash: string): void {
    this.db
      .prepare(
        `INSERT INTO repo_hook_trust (root_path, kind, content_hash, approved_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(root_path, kind) DO UPDATE SET content_hash = excluded.content_hash, approved_at = excluded.approved_at`
      )
      .run(trustKey(rootPath), kind, contentHash, this.now())
  }
}
