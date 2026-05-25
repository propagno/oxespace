import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../db/index'
import type { AgentProvider } from '../../../shared/types/agent'
import type {
  AddIntegrationMemberInput,
  AttachIntegrationSessionInput,
  CreateIntegrationGroupInput,
  CreateIntegrationHandoffInput,
  UpdateIntegrationHandoffInput,
  IntegrationContextResult,
  IntegrationGroup,
  IntegrationHandoff,
  IntegrationMember,
  IntegrationRole,
  IntegrationSession,
  IntegrationStatus,
  UpdateIntegrationGroupInput,
  UpdateIntegrationMemberInput
} from '../../../shared/types/integration'

interface GroupRow {
  id: string
  name: string
  goal: string
  description: string | null
  status: IntegrationStatus
  active_workspace_id: string | null
  created_at: number
  updated_at: number
}

interface MemberRow {
  id: string
  group_id: string
  workspace_id: string
  workspace_name: string
  workspace_root_path: string
  pane_id: string | null
  root_path: string | null
  role: IntegrationRole
  alias: string
  last_intent: string | null
  last_result: string | null
  blockers: string | null
  updated_at: number
}

interface SessionRow {
  id: string
  group_id: string
  member_id: string
  workspace_id: string
  root_path: string
  provider: AgentProvider
  session_id: string
  label: string | null
  updated_at: number
}

interface HandoffRow {
  id: string
  group_id: string
  from_member_id: string
  to_member_id: string
  title: string
  content: string
  status: 'draft' | 'sent' | 'saved'
  created_at: number
}

export class IntegrationService {
  constructor(private readonly db: AppDatabase) {}

  listGroups(workspaceId?: string | null): IntegrationGroup[] {
    const rows = workspaceId
      ? this.db.prepare(`
          SELECT DISTINCT g.*
          FROM integration_groups g
          JOIN integration_group_members m ON m.group_id = g.id
          WHERE m.workspace_id = ?
          ORDER BY g.updated_at DESC
        `).all(workspaceId) as GroupRow[]
      : this.db.prepare('SELECT * FROM integration_groups ORDER BY updated_at DESC').all() as GroupRow[]
    return rows.map((row) => this.mapGroup(row))
  }

  getGroup(groupId: string): IntegrationGroup {
    const row = this.db.prepare('SELECT * FROM integration_groups WHERE id = ?').get(groupId) as GroupRow | undefined
    if (!row) throw new Error(`Integration group ${groupId} not found`)
    return this.mapGroup(row)
  }

  createGroup(input: CreateIntegrationGroupInput): IntegrationGroup {
    const now = Date.now()
    const id = randomUUID()
    this.db.prepare(`
      INSERT INTO integration_groups (id, name, goal, description, status, active_workspace_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(id, input.name.trim(), input.goal.trim(), cleanNullable(input.description), input.activeWorkspaceId ?? null, now, now)
    return this.getGroup(id)
  }

  updateGroup(input: UpdateIntegrationGroupInput): IntegrationGroup {
    const current = this.getGroup(input.groupId)
    this.db.prepare(`
      UPDATE integration_groups
      SET name = ?, goal = ?, description = ?, status = ?, active_workspace_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.name?.trim() || current.name,
      input.goal?.trim() || current.goal,
      input.description === undefined ? current.description : cleanNullable(input.description),
      input.status ?? current.status,
      input.activeWorkspaceId === undefined ? current.activeWorkspaceId : input.activeWorkspaceId,
      Date.now(),
      input.groupId
    )
    return this.getGroup(input.groupId)
  }

  deleteGroup(groupId: string): void {
    this.db.prepare('DELETE FROM integration_groups WHERE id = ?').run(groupId)
  }

  addMember(input: AddIntegrationMemberInput): IntegrationGroup {
    const workspace = this.db.prepare('SELECT id, name, root_path FROM workspaces WHERE id = ?').get(input.workspaceId) as { id: string; name: string; root_path: string } | undefined
    if (!workspace) throw new Error(`Workspace ${input.workspaceId} not found`)
    const pane = input.paneId
      ? this.db.prepare('SELECT id, root_path FROM panes WHERE id = ? AND workspace_id = ?').get(input.paneId, input.workspaceId) as { id: string; root_path: string | null } | undefined
      : null
    if (input.paneId && !pane) throw new Error(`Pane ${input.paneId} not found in workspace`)
    const rootPath = input.rootPath?.trim() || pane?.root_path || workspace.root_path
    if (!existsSync(rootPath)) throw new Error(`Member root path does not exist: ${rootPath}`)
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO integration_group_members (id, group_id, workspace_id, pane_id, root_path, role, alias, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), input.groupId, input.workspaceId, input.paneId ?? null, rootPath, input.role, input.alias?.trim() || input.role.toUpperCase(), now)
    this.touchGroup(input.groupId)
    return this.getGroup(input.groupId)
  }

  updateMember(input: UpdateIntegrationMemberInput): IntegrationGroup {
    const member = this.getMember(input.memberId)
    this.db.prepare(`
      UPDATE integration_group_members
      SET pane_id = ?, root_path = ?, role = ?, alias = ?, last_intent = ?, last_result = ?, blockers = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.paneId === undefined ? member.paneId : input.paneId,
      input.rootPath === undefined ? member.rootPath : input.rootPath,
      input.role ?? member.role,
      input.alias?.trim() || member.alias,
      input.lastIntent === undefined ? member.lastIntent : cleanNullable(input.lastIntent),
      input.lastResult === undefined ? member.lastResult : cleanNullable(input.lastResult),
      input.blockers === undefined ? member.blockers : cleanNullable(input.blockers),
      Date.now(),
      input.memberId
    )
    this.touchGroup(member.groupId)
    return this.getGroup(member.groupId)
  }

  removeMember(memberId: string): IntegrationGroup {
    const member = this.getMember(memberId)
    this.db.prepare('DELETE FROM integration_group_members WHERE id = ?').run(memberId)
    this.touchGroup(member.groupId)
    return this.getGroup(member.groupId)
  }

  attachSession(input: AttachIntegrationSessionInput): IntegrationSession {
    const now = Date.now()
    const id = randomUUID()
    this.db.prepare(`
      INSERT INTO integration_group_sessions (id, group_id, member_id, workspace_id, root_path, provider, session_id, label, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(member_id, provider) DO UPDATE SET
        group_id = excluded.group_id,
        workspace_id = excluded.workspace_id,
        root_path = excluded.root_path,
        session_id = excluded.session_id,
        label = excluded.label,
        updated_at = excluded.updated_at
    `).run(id, input.groupId, input.memberId, input.workspaceId, input.rootPath, input.provider, input.sessionId, cleanNullable(input.label), now)
    this.touchGroup(input.groupId)
    return this.getSessionsForMember(input.memberId).find((s) => s.provider === input.provider)!
  }

  listHandoffs(groupId: string): IntegrationHandoff[] {
    const rows = this.db.prepare('SELECT * FROM integration_handoffs WHERE group_id = ? ORDER BY created_at DESC').all(groupId) as HandoffRow[]
    return rows.map(mapHandoff)
  }

  createHandoff(input: CreateIntegrationHandoffInput): IntegrationHandoff {
    const now = Date.now()
    const id = randomUUID()
    this.db.prepare(`
      INSERT INTO integration_handoffs (id, group_id, from_member_id, to_member_id, title, content, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.groupId, input.fromMemberId, input.toMemberId, input.title.trim(), input.content.trim(), input.status ?? 'draft', now)
    this.touchGroup(input.groupId)
    return this.listHandoffs(input.groupId).find((handoff) => handoff.id === id)!
  }

  /**
   * Mutates a handoff in place. Used primarily to flip 'sent' → 'saved' once
   * the recipient has applied the message to their agent — without that
   * transition the inbox would keep highlighting the same handoff as
   * "needs your attention" forever. Title/content updates also flow through
   * here so an author can correct a handoff before the recipient acts on it.
   */
  updateHandoff(input: UpdateIntegrationHandoffInput): IntegrationHandoff {
    const existing = this.db.prepare('SELECT * FROM integration_handoffs WHERE id = ?').get(input.handoffId) as HandoffRow | undefined
    if (!existing) throw new Error(`Handoff ${input.handoffId} not found`)
    const status = input.status ?? existing.status
    const title = input.title?.trim() ?? existing.title
    const content = input.content?.trim() ?? existing.content
    this.db.prepare(`
      UPDATE integration_handoffs SET status = ?, title = ?, content = ? WHERE id = ?
    `).run(status, title, content, input.handoffId)
    this.touchGroup(existing.group_id)
    return this.listHandoffs(existing.group_id).find((h) => h.id === input.handoffId)!
  }

  buildContext(groupId: string, currentMemberId?: string | null): IntegrationContextResult {
    const group = this.getGroup(groupId)
    const current = currentMemberId ? group.members.find((m) => m.id === currentMemberId) ?? null : null
    const lines = [
      `# Integration context: ${group.name}`,
      '',
      `Goal: ${group.goal}`,
      group.description ? `Description: ${group.description}` : null,
      current ? `Current repo role: ${current.role} (${current.alias})` : null,
      '',
      '## Members',
      ...group.members.map((m) => {
        const parts = [
          `${m.role}/${m.alias}`,
          `workspace=${m.workspaceName}`,
          `branch=${m.branch ?? 'unknown'}`,
          `path=${m.rootPath}`,
          m.activeProvider ? `session=${m.activeProvider}:${m.activeSessionId ?? 'unlinked'}` : 'session=unlinked',
          m.blockers ? `blocker=${m.blockers}` : null
        ].filter(Boolean)
        return `- ${parts.join(' | ')}`
      }),
      '',
      'Use this as integration context only. Do not assume files from other repos are available in this terminal unless their path is shown above.'
    ].filter((line): line is string => line !== null)
    return { groupId, text: lines.join('\n') }
  }

  private mapGroup(row: GroupRow): IntegrationGroup {
    const members = this.listMembers(row.id)
    return {
      id: row.id,
      name: row.name,
      goal: row.goal,
      description: row.description,
      status: row.status,
      activeWorkspaceId: row.active_workspace_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      members
    }
  }

  private listMembers(groupId: string): IntegrationMember[] {
    const rows = this.db.prepare(`
      SELECT m.*, w.name AS workspace_name, w.root_path AS workspace_root_path
      FROM integration_group_members m
      JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.group_id = ?
      ORDER BY
        CASE m.role
          WHEN 'fed' THEN 1 WHEN 'bff' THEN 2 WHEN 'srv' THEN 3
          WHEN 'api' THEN 4 WHEN 'apim' THEN 5 WHEN 'mktapi' THEN 6
          WHEN 'aut' THEN 7 WHEN 'lib' THEN 8 WHEN 'db' THEN 9
          WHEN 'infra' THEN 10 WHEN 'docs' THEN 11
          ELSE 12
        END,
        m.alias COLLATE NOCASE
    `).all(groupId) as MemberRow[]
    return rows.map((row) => {
      const sessions = this.getSessionsForMember(row.id)
      const recent = sessions.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
      const rootPath = row.root_path || row.workspace_root_path
      return {
        id: row.id,
        groupId: row.group_id,
        workspaceId: row.workspace_id,
        workspaceName: row.workspace_name,
        workspaceRootPath: row.workspace_root_path,
        paneId: row.pane_id,
        rootPath,
        role: row.role,
        alias: row.alias,
        branch: readGitBranch(rootPath),
        activeProvider: recent?.provider ?? null,
        activeSessionId: recent?.sessionId ?? null,
        lastIntent: row.last_intent,
        lastResult: row.last_result,
        blockers: row.blockers,
        updatedAt: row.updated_at
      }
    })
  }

  private getMember(memberId: string): IntegrationMember {
    const row = this.db.prepare(`
      SELECT m.*, w.name AS workspace_name, w.root_path AS workspace_root_path
      FROM integration_group_members m
      JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.id = ?
    `).get(memberId) as MemberRow | undefined
    if (!row) throw new Error(`Integration member ${memberId} not found`)
    return this.listMembers(row.group_id).find((member) => member.id === memberId)!
  }

  private getSessionsForMember(memberId: string): IntegrationSession[] {
    const rows = this.db.prepare('SELECT * FROM integration_group_sessions WHERE member_id = ?').all(memberId) as SessionRow[]
    return rows.map((row) => ({
      id: row.id,
      groupId: row.group_id,
      memberId: row.member_id,
      workspaceId: row.workspace_id,
      rootPath: row.root_path,
      provider: row.provider,
      sessionId: row.session_id,
      label: row.label,
      updatedAt: row.updated_at
    }))
  }

  private touchGroup(groupId: string): void {
    this.db.prepare('UPDATE integration_groups SET updated_at = ? WHERE id = ?').run(Date.now(), groupId)
  }
}

function mapHandoff(row: HandoffRow): IntegrationHandoff {
  return {
    id: row.id,
    groupId: row.group_id,
    fromMemberId: row.from_member_id,
    toMemberId: row.to_member_id,
    title: row.title,
    content: row.content,
    status: row.status,
    createdAt: row.created_at
  }
}

function cleanNullable(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

function readGitBranch(rootPath: string): string | null {
  if (!rootPath || !existsSync(rootPath)) return null
  const result = spawnSync('git', ['branch', '--show-current'], {
    cwd: rootPath,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 1500
  })
  const branch = result.status === 0 ? result.stdout.trim() : ''
  if (branch) return branch
  const detached = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: rootPath,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 1500
  })
  return detached.status === 0 && detached.stdout.trim() ? `detached:${detached.stdout.trim()}` : null
}
