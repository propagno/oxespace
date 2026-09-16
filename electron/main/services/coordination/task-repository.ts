import type { AppDatabase } from '../../db'
import type { CoordinationScope } from '../../../../shared/types/coordination'

/** Metadata only. Does not authorize callers, launch agents or duplicate lifecycle. */
export class CoordinationTaskRepository {
  constructor(private readonly db: AppDatabase) {}

  getScope(taskId: string): CoordinationScope | undefined {
    return this.db.prepare(`SELECT task_id AS taskId,
      origin_workspace_id AS originWorkspaceId, origin_project_id AS originProjectId,
      target_workspace_id AS targetWorkspaceId, target_project_id AS targetProjectId,
      revision FROM coordination_scopes WHERE task_id = ?`).get(taskId) as CoordinationScope | undefined
  }

  /** Compare-and-swap used by future authorized coordination operations. */
  advanceRevision(taskId: string, expectedRevision: number): number {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('Invalid coordination revision')
    const result = this.db.prepare(`UPDATE coordination_scopes SET revision = revision + 1
      WHERE task_id = ? AND revision = ?`).run(taskId, expectedRevision)
    if (result.changes !== 1) throw new Error('Coordination revision conflict')
    return expectedRevision + 1
  }
}
