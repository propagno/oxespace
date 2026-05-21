import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../db/index'
import type {
  CreateWorkspaceInput,
  PaneAgentBinding,
  PaneStatus,
  PaneType,
  Workspace,
  WorkspaceDensity,
  WorkspaceLayout,
  WorkspaceLayoutPreset,
  WorkspaceThemeId,
  UpdateWorkspaceSettingsInput,
  UpdateWorkspaceEditorStateInput,
  UpdateWorkspaceGitHubStateInput,
  UpdateWorkspaceBackgroundStateInput,
  UpdateWorkspaceReviewStateInput,
  WorkspacePane
} from '../../../shared/types/workspace'

interface WorkspaceRow {
  id: string
  name: string
  root_path: string
  layout: WorkspaceLayout
  layout_preset: WorkspaceLayoutPreset
  theme_id: WorkspaceThemeId
  ui_density: WorkspaceDensity
  default_shell_profile_id: string
  auto_start: number
  is_active: number
  editor_visible: number
  editor_expanded: number
  editor_width_percent: number
  review_panel_visible: number
  review_panel_expanded: number
  review_panel_width_percent: number
  github_panel_visible: number
  github_panel_expanded: number
  github_panel_width_percent: number
  github_active_tab: Workspace['githubActiveTab']
  background_panel_visible: number
  background_panel_expanded: number
  background_panel_width_percent: number
}

interface PaneRow {
  id: string
  workspace_id: string
  type: PaneType
  row_index: number
  column_index: number
  shell_profile_id: string | null
  status: PaneStatus
  agent_profile_id: string | null
  agent_name: string | null
  display_name: string | null
  created_at: string | null
  root_path: string | null
}

const DEFAULT_SHELL_PROFILE_ID = 'builtin-claude'
const DEFAULT_SPLIT_SHELL_PROFILE_ID = 'builtin-powershell'
const DEFAULT_THEME_ID: WorkspaceThemeId = 'dracula'
const DEFAULT_UI_DENSITY: WorkspaceDensity = 'compact'
const DEFAULT_LAYOUT_PRESET: WorkspaceLayoutPreset = 4

const PRESET_LAYOUTS: Record<WorkspaceLayoutPreset, WorkspaceLayout> = {
  1: '1x1',
  2: '1x2',
  4: '2x2',
  6: '2x3',
  8: '2x4',
  10: '2x5',
  12: '3x4',
  14: '2x7',
  16: '4x4'
}

export class WorkspaceService {
  constructor(private readonly db: AppDatabase) {}

  create(input: CreateWorkspaceInput): Workspace {
    const layoutPreset = input.layoutPreset ?? layoutToPreset(input.layout) ?? DEFAULT_LAYOUT_PRESET
    const layout = PRESET_LAYOUTS[layoutPreset]
    const workspaceId = randomUUID()
    const shellProfileId = input.defaultShellProfileId ?? DEFAULT_SHELL_PROFILE_ID
    const name = input.name?.trim() || basename(input.rootPath)
    const autoStart = input.autoStart !== false
    const themeId = input.themeId ?? DEFAULT_THEME_ID
    const uiDensity = input.uiDensity ?? DEFAULT_UI_DENSITY

    const createWorkspace = this.db.transaction(() => {
      this.db.prepare('UPDATE workspaces SET is_active = 0').run()
      this.db
        .prepare(
          `INSERT INTO workspaces
            (id, name, root_path, layout, layout_preset, theme_id, ui_density, default_shell_profile_id, auto_start, is_active)
           VALUES
            (@id, @name, @rootPath, @layout, @layoutPreset, @themeId, @uiDensity, @defaultShellProfileId, @autoStart, 1)`
        )
        .run({
          id: workspaceId,
          name,
          rootPath: input.rootPath,
          layout,
          layoutPreset,
          themeId,
          uiDensity,
          defaultShellProfileId: shellProfileId,
          autoStart: autoStart ? 1 : 0
        })

      const insertPane = this.db.prepare(
        `INSERT INTO panes
          (id, workspace_id, type, row_index, column_index, shell_profile_id, status, agent_profile_id, agent_name)
         VALUES
          (@id, @workspaceId, 'terminal', @rowIndex, @columnIndex, @shellProfileId, 'idle', @agentProfileId, @agentName)`
      )

      const bindings = buildBindingMap(input.agentBindings)
      for (const [index, position] of getPanePositions(layout).entries()) {
        const binding = bindings.get(index)
        insertPane.run({
          id: randomUUID(),
          workspaceId,
          rowIndex: position.rowIndex,
          columnIndex: position.columnIndex,
          shellProfileId,
          agentProfileId: binding?.agentProfileId ?? null,
          agentName: binding?.agentName ?? null
        })
      }
    })

    createWorkspace()
    const workspace = this.get(workspaceId)
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} was not persisted`)
    }
    return workspace
  }

  list(): Workspace[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, root_path, layout, layout_preset, theme_id, ui_density, default_shell_profile_id, auto_start, is_active,
          editor_visible, editor_expanded, editor_width_percent,
          review_panel_visible, review_panel_expanded, review_panel_width_percent,
          github_panel_visible, github_panel_expanded, github_panel_width_percent, github_active_tab,
          background_panel_visible, background_panel_expanded, background_panel_width_percent
         FROM workspaces
         ORDER BY created_at ASC`
      )
      .all() as WorkspaceRow[]

    return rows.map((row) => this.mapWorkspace(row))
  }

  get(id: string): Workspace | null {
    const row = this.db
      .prepare(
        `SELECT id, name, root_path, layout, layout_preset, theme_id, ui_density, default_shell_profile_id, auto_start, is_active,
          editor_visible, editor_expanded, editor_width_percent,
          review_panel_visible, review_panel_expanded, review_panel_width_percent,
          github_panel_visible, github_panel_expanded, github_panel_width_percent, github_active_tab,
          background_panel_visible, background_panel_expanded, background_panel_width_percent
         FROM workspaces
         WHERE id = ?`
      )
      .get(id) as WorkspaceRow | undefined

    return row ? this.mapWorkspace(row) : null
  }

  setActive(id: string): Workspace {
    const setActive = this.db.transaction(() => {
      this.db.prepare('UPDATE workspaces SET is_active = 0').run()
      const result = this.db.prepare('UPDATE workspaces SET is_active = 1 WHERE id = ?').run(id)
      if (result.changes !== 1) {
        throw new Error(`Workspace ${id} not found`)
      }
    })

    setActive()
    const workspace = this.get(id)
    if (!workspace) {
      throw new Error(`Workspace ${id} not found`)
    }
    return workspace
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
  }

  closePane(id: string): Workspace | null {
    const paneRow = this.db
      .prepare('SELECT workspace_id, row_index FROM panes WHERE id = ?')
      .get(id) as { workspace_id: string; row_index: number } | undefined
    if (!paneRow) {
      this.db.prepare('DELETE FROM panes WHERE id = ?').run(id)
      return null
    }
    const workspaceId = paneRow.workspace_id

    const compact = this.db.transaction(() => {
      this.db.prepare('DELETE FROM panes WHERE id = ?').run(id)
      // Off-grid panes (e.g. the GitHub helper pane uses row=-1, col=-1) live
      // outside the layout and must not be repacked. Only repack the regular
      // in-grid panes so closing one reflows the visible grid.
      const gridPanes = this.db
        .prepare(
          `SELECT id, row_index, column_index FROM panes
           WHERE workspace_id = ? AND row_index >= 0
           ORDER BY row_index ASC, column_index ASC`
        )
        .all(workspaceId) as Array<{ id: string; row_index: number; column_index: number }>

      const remaining = gridPanes.length
      if (remaining === 0) return

      const nextPreset = findSmallestPresetFor(remaining)
      const nextLayout = PRESET_LAYOUTS[nextPreset]
      const positions = getPanePositions(nextLayout)
      const updatePane = this.db.prepare(
        "UPDATE panes SET row_index = ?, column_index = ?, updated_at = datetime('now') WHERE id = ?"
      )
      for (let i = 0; i < gridPanes.length; i += 1) {
        const target = positions[i]
        if (!target) break
        if (gridPanes[i].row_index !== target.rowIndex || gridPanes[i].column_index !== target.columnIndex) {
          updatePane.run(target.rowIndex, target.columnIndex, gridPanes[i].id)
        }
      }
      this.db
        .prepare("UPDATE workspaces SET layout = ?, layout_preset = ?, updated_at = datetime('now') WHERE id = ?")
        .run(nextLayout, nextPreset, workspaceId)
    })

    compact()
    return this.get(workspaceId)
  }

  updatePaneType(paneId: string, type: PaneType): Workspace {
    const paneRow = this.db
      .prepare('SELECT id, workspace_id, type, row_index, column_index, shell_profile_id, status FROM panes WHERE id = ?')
      .get(paneId) as PaneRow | undefined
    if (!paneRow) throw new Error(`Pane ${paneId} not found`)

    this.db.prepare("UPDATE panes SET type = ?, status = 'idle' WHERE id = ?").run(type, paneId)
    const workspace = this.get(paneRow.workspace_id)
    if (!workspace) throw new Error('Workspace not found after pane type update')
    return workspace
  }

  updateEditorState(input: UpdateWorkspaceEditorStateInput): Workspace {
    const current = this.get(input.workspaceId)
    if (!current) throw new Error(`Workspace ${input.workspaceId} not found`)

    const editorVisible = input.editorVisible ?? current.editorVisible ?? false
    const editorExpanded = input.editorExpanded ?? current.editorExpanded ?? false
    const editorWidthPercent = clampEditorWidth(input.editorWidthPercent ?? current.editorWidthPercent ?? 40)

    this.db
      .prepare(
        `UPDATE workspaces
         SET editor_visible = @editorVisible,
             editor_expanded = @editorExpanded,
             editor_width_percent = @editorWidthPercent,
             updated_at = datetime('now')
         WHERE id = @workspaceId`
      )
      .run({
        workspaceId: input.workspaceId,
        editorVisible: editorVisible ? 1 : 0,
        editorExpanded: editorExpanded ? 1 : 0,
        editorWidthPercent
      })

    const workspace = this.get(input.workspaceId)
    if (!workspace) throw new Error('Workspace not found after editor state update')
    return workspace
  }

  updateReviewState(input: UpdateWorkspaceReviewStateInput): Workspace {
    const current = this.get(input.workspaceId)
    if (!current) throw new Error(`Workspace ${input.workspaceId} not found`)

    const reviewPanelVisible = input.reviewPanelVisible ?? current.reviewPanelVisible ?? false
    const reviewPanelExpanded = input.reviewPanelExpanded ?? current.reviewPanelExpanded ?? false
    const reviewPanelWidthPercent = clampPanelWidth(input.reviewPanelWidthPercent ?? current.reviewPanelWidthPercent ?? 36)

    this.db
      .prepare(
        `UPDATE workspaces
         SET review_panel_visible = @reviewPanelVisible,
             review_panel_expanded = @reviewPanelExpanded,
             review_panel_width_percent = @reviewPanelWidthPercent,
             updated_at = datetime('now')
         WHERE id = @workspaceId`
      )
      .run({
        workspaceId: input.workspaceId,
        reviewPanelVisible: reviewPanelVisible ? 1 : 0,
        reviewPanelExpanded: reviewPanelExpanded ? 1 : 0,
        reviewPanelWidthPercent
      })

    const workspace = this.get(input.workspaceId)
    if (!workspace) throw new Error('Workspace not found after Review state update')
    return workspace
  }

  updateGitHubState(input: UpdateWorkspaceGitHubStateInput): Workspace {
    const current = this.get(input.workspaceId)
    if (!current) throw new Error(`Workspace ${input.workspaceId} not found`)

    const githubPanelVisible = input.githubPanelVisible ?? current.githubPanelVisible ?? false
    const githubPanelExpanded = input.githubPanelExpanded ?? current.githubPanelExpanded ?? false
    const githubPanelWidthPercent = clampPanelWidth(input.githubPanelWidthPercent ?? current.githubPanelWidthPercent ?? 40)
    const githubActiveTab = input.githubActiveTab ?? current.githubActiveTab ?? 'status'

    this.db
      .prepare(
        `UPDATE workspaces
         SET github_panel_visible = @githubPanelVisible,
             github_panel_expanded = @githubPanelExpanded,
             github_panel_width_percent = @githubPanelWidthPercent,
             github_active_tab = @githubActiveTab,
             updated_at = datetime('now')
         WHERE id = @workspaceId`
      )
      .run({
        workspaceId: input.workspaceId,
        githubPanelVisible: githubPanelVisible ? 1 : 0,
        githubPanelExpanded: githubPanelExpanded ? 1 : 0,
        githubPanelWidthPercent,
        githubActiveTab
      })

    const workspace = this.get(input.workspaceId)
    if (!workspace) throw new Error('Workspace not found after GitHub state update')
    return workspace
  }

  updateBackgroundState(input: UpdateWorkspaceBackgroundStateInput): Workspace {
    const current = this.get(input.workspaceId)
    if (!current) throw new Error(`Workspace ${input.workspaceId} not found`)

    const backgroundPanelVisible = input.backgroundPanelVisible ?? current.backgroundPanelVisible ?? false
    const backgroundPanelExpanded = input.backgroundPanelExpanded ?? current.backgroundPanelExpanded ?? false
    const backgroundPanelWidthPercent = clampPanelWidth(input.backgroundPanelWidthPercent ?? current.backgroundPanelWidthPercent ?? 36)

    this.db
      .prepare(
        `UPDATE workspaces
         SET background_panel_visible = @backgroundPanelVisible,
             background_panel_expanded = @backgroundPanelExpanded,
             background_panel_width_percent = @backgroundPanelWidthPercent,
             updated_at = datetime('now')
         WHERE id = @workspaceId`
      )
      .run({
        workspaceId: input.workspaceId,
        backgroundPanelVisible: backgroundPanelVisible ? 1 : 0,
        backgroundPanelExpanded: backgroundPanelExpanded ? 1 : 0,
        backgroundPanelWidthPercent
      })

    const workspace = this.get(input.workspaceId)
    if (!workspace) throw new Error('Workspace not found after Background state update')
    return workspace
  }

  updateSettings(input: UpdateWorkspaceSettingsInput): Workspace {
    const current = this.get(input.workspaceId)
    if (!current) throw new Error(`Workspace ${input.workspaceId} not found`)

    const nextPreset = input.layoutPreset ?? current.layoutPreset
    const nextLayout = PRESET_LAYOUTS[nextPreset]
    const nextShellProfileId = input.defaultShellProfileId ?? current.defaultShellProfileId
    const nextPositions = getPanePositions(nextLayout)
    const nextPositionKeys = new Set(nextPositions.map(positionKey))
    const panesToRemove = current.panes.filter((pane) => !nextPositionKeys.has(positionKey(pane)))
    const lockedPane = panesToRemove.find((pane) => pane.status !== 'idle' && pane.status !== 'exited')
    if (lockedPane) {
      throw new Error('Cannot reduce layout while removed panes are running')
    }

    const updateWorkspace = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE workspaces
           SET theme_id = @themeId,
               ui_density = @uiDensity,
               default_shell_profile_id = @defaultShellProfileId,
               layout = @layout,
               layout_preset = @layoutPreset,
               updated_at = datetime('now')
           WHERE id = @workspaceId`
        )
        .run({
          workspaceId: input.workspaceId,
          themeId: input.themeId ?? current.themeId,
          uiDensity: input.uiDensity ?? current.uiDensity,
          defaultShellProfileId: nextShellProfileId,
          layout: nextLayout,
          layoutPreset: nextPreset
        })

      for (const pane of panesToRemove) {
        this.db.prepare('DELETE FROM panes WHERE id = ?').run(pane.id)
      }

      const existingKeys = new Set(current.panes.filter((pane) => nextPositionKeys.has(positionKey(pane))).map(positionKey))
      const insertPane = this.db.prepare(
        `INSERT INTO panes (id, workspace_id, type, row_index, column_index, shell_profile_id, status)
         VALUES (@id, @workspaceId, 'terminal', @rowIndex, @columnIndex, @shellProfileId, 'idle')`
      )
      for (const position of nextPositions) {
        if (existingKeys.has(positionKey(position))) continue
        insertPane.run({
          id: randomUUID(),
          workspaceId: input.workspaceId,
          rowIndex: position.rowIndex,
          columnIndex: position.columnIndex,
          shellProfileId: nextShellProfileId
        })
      }

      if (input.applyShellToIdlePanes === true) {
        this.db
          .prepare("UPDATE panes SET shell_profile_id = ?, updated_at = datetime('now') WHERE workspace_id = ? AND status IN ('idle', 'exited')")
          .run(nextShellProfileId, input.workspaceId)
      }
    })

    updateWorkspace()
    const workspace = this.get(input.workspaceId)
    if (!workspace) throw new Error('Workspace not found after settings update')
    return workspace
  }

  createGitHubTerminalPane(workspaceId: string): { id: string } {
    const id = randomUUID()
    this.db.prepare(
      `INSERT OR IGNORE INTO panes (id, workspace_id, type, row_index, column_index, shell_profile_id, status)
       VALUES (?, ?, 'terminal', -1, -1, 'builtin-copilot', 'idle')`
    ).run(id, workspaceId)
    const pane = this.db.prepare(
      `SELECT id FROM panes WHERE workspace_id = ? AND row_index = -1 AND column_index = -1`
    ).get(workspaceId) as { id: string }
    return pane
  }

  splitPane(paneId: string, direction: 'vertical' | 'horizontal'): Workspace {
    const paneRow = this.db
      .prepare('SELECT id, workspace_id, type, row_index, column_index, shell_profile_id, status FROM panes WHERE id = ?')
      .get(paneId) as PaneRow | undefined
    if (!paneRow) throw new Error(`Pane ${paneId} not found`)

    const workspace = this.get(paneRow.workspace_id)
    if (!workspace) throw new Error('Workspace not found')

    const [currentRows, currentCols] = workspace.layout.split('x').map(Number)
    const targetRow = direction === 'horizontal' ? paneRow.row_index + 1 : paneRow.row_index
    const targetCol = direction === 'vertical' ? paneRow.column_index + 1 : paneRow.column_index

    const occupied = workspace.panes.find((p) => p.rowIndex === targetRow && p.columnIndex === targetCol)
    if (occupied) throw new Error('Target slot is already occupied')

    let newLayout: WorkspaceLayout = workspace.layout
    if (direction === 'vertical' && targetCol >= currentCols) {
      const upgraded = LAYOUT_UPGRADE_VERTICAL[workspace.layout]
      if (!upgraded) throw new Error('Cannot split vertically: layout limit reached')
      newLayout = upgraded
    } else if (direction === 'horizontal' && targetRow >= currentRows) {
      const upgraded = LAYOUT_UPGRADE_HORIZONTAL[workspace.layout]
      if (!upgraded) throw new Error('Cannot split horizontally: layout limit reached')
      newLayout = upgraded
    }

    const doSplit = this.db.transaction(() => {
      if (newLayout !== workspace.layout) {
        this.db.prepare('UPDATE workspaces SET layout = ?, layout_preset = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newLayout, layoutToPreset(newLayout) ?? workspace.layoutPreset, paneRow.workspace_id)
      }
      this.db
        .prepare(
          `INSERT INTO panes (id, workspace_id, type, row_index, column_index, shell_profile_id, status, agent_profile_id, agent_name, display_name)
           VALUES (@id, @workspaceId, 'terminal', @rowIndex, @columnIndex, @shellProfileId, 'idle', NULL, NULL, NULL)`
        )
        .run({
          id: randomUUID(),
          workspaceId: paneRow.workspace_id,
          rowIndex: targetRow,
          columnIndex: targetCol,
          shellProfileId: DEFAULT_SPLIT_SHELL_PROFILE_ID
        })
    })

    doSplit()
    const updated = this.get(paneRow.workspace_id)
    if (!updated) throw new Error('Workspace not found after split')
    return updated
  }

  private mapWorkspace(row: WorkspaceRow): Workspace {
    return {
      id: row.id,
      name: row.name,
      rootPath: row.root_path,
      layout: row.layout,
      layoutPreset: row.layout_preset || layoutToPreset(row.layout) || DEFAULT_LAYOUT_PRESET,
      themeId: row.theme_id || DEFAULT_THEME_ID,
      uiDensity: row.ui_density || DEFAULT_UI_DENSITY,
      defaultShellProfileId: row.default_shell_profile_id,
      autoStart: row.auto_start === 1,
      isActive: row.is_active === 1,
      editorVisible: row.editor_visible === 1,
      editorExpanded: row.editor_expanded === 1,
      editorWidthPercent: row.editor_width_percent || 40,
      reviewPanelVisible: row.review_panel_visible === 1,
      reviewPanelExpanded: row.review_panel_expanded === 1,
      reviewPanelWidthPercent: row.review_panel_width_percent || 36,
      githubPanelVisible: row.github_panel_visible === 1,
      githubPanelExpanded: row.github_panel_expanded === 1,
      githubPanelWidthPercent: row.github_panel_width_percent || 40,
      githubActiveTab: row.github_active_tab || 'status',
      backgroundPanelVisible: row.background_panel_visible === 1,
      backgroundPanelExpanded: row.background_panel_expanded === 1,
      backgroundPanelWidthPercent: row.background_panel_width_percent || 36,
      panes: this.listPanes(row.id)
    }
  }

  updatePaneName(paneId: string, displayName: string | null): Workspace {
    const paneRow = this.db
      .prepare('SELECT workspace_id FROM panes WHERE id = ?')
      .get(paneId) as Pick<PaneRow, 'workspace_id'> | undefined
    if (!paneRow) throw new Error(`Pane ${paneId} not found`)

    this.db.prepare("UPDATE panes SET display_name = ?, updated_at = datetime('now') WHERE id = ?").run(displayName, paneId)
    const workspace = this.get(paneRow.workspace_id)
    if (!workspace) throw new Error('Workspace not found after pane name update')
    return workspace
  }

  private listPanes(workspaceId: string): WorkspacePane[] {
    const rows = this.db
      .prepare(
        `SELECT id, workspace_id, type, row_index, column_index, shell_profile_id, status, agent_profile_id, agent_name, display_name, created_at, root_path
         FROM panes
         WHERE workspace_id = ?
         ORDER BY row_index ASC, column_index ASC`
      )
      .all(workspaceId) as PaneRow[]

    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      type: row.type,
      rowIndex: row.row_index,
      columnIndex: row.column_index,
      shellProfileId: row.shell_profile_id,
      status: row.status,
      agentProfileId: row.agent_profile_id,
      agentName: row.agent_name,
      displayName: row.display_name ?? null,
      createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
      rootPath: row.root_path ?? null
    }))
  }

  setPaneAgent(paneId: string, agentProfileId: string | null, agentName: string | null): Workspace {
    const exists = this.db.prepare('SELECT workspace_id FROM panes WHERE id = ?').get(paneId) as { workspace_id: string } | undefined
    if (!exists) throw new Error(`Pane ${paneId} not found`)
    this.db
      .prepare("UPDATE panes SET agent_profile_id = ?, agent_name = ?, updated_at = datetime('now') WHERE id = ?")
      .run(agentProfileId, agentName, paneId)
    const workspace = this.get(exists.workspace_id)
    if (!workspace) throw new Error('Workspace not found after agent update')
    return workspace
  }

  setPaneRootPath(paneId: string, rootPath: string | null): Workspace {
    const exists = this.db.prepare('SELECT workspace_id FROM panes WHERE id = ?').get(paneId) as { workspace_id: string } | undefined
    if (!exists) throw new Error(`Pane ${paneId} not found`)
    this.db
      .prepare("UPDATE panes SET root_path = ?, updated_at = datetime('now') WHERE id = ?")
      .run(rootPath, paneId)
    const workspace = this.get(exists.workspace_id)
    if (!workspace) throw new Error('Workspace not found after rootPath update')
    return workspace
  }
}

function clampEditorWidth(width: number): number {
  return clampPanelWidth(width)
}

function clampPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return 40
  return Math.min(70, Math.max(25, Math.round(width)))
}

const LAYOUT_UPGRADE_VERTICAL: Partial<Record<WorkspaceLayout, WorkspaceLayout>> = {
  '1x1': '1x2',
  '2x1': '2x2',
  '2x2': '2x3',
  '2x3': '2x4',
  '2x4': '2x5',
  '2x5': '2x7'
}

const LAYOUT_UPGRADE_HORIZONTAL: Partial<Record<WorkspaceLayout, WorkspaceLayout>> = {
  '1x1': '2x1',
  '1x2': '2x2',
  '2x2': '3x4',
  '3x4': '4x4'
}

export function getPanePositions(layout: WorkspaceLayout): Array<{ rowIndex: number; columnIndex: number }> {
  const [rows, columns] = layout.split('x').map(Number)
  const positions: Array<{ rowIndex: number; columnIndex: number }> = []

  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
      positions.push({ rowIndex, columnIndex })
    }
  }

  return positions
}

/**
 * Pick the smallest preset whose cell count fits `remaining` panes. The preset
 * key is itself the cell count, so the smallest key >= remaining wins. Caps at
 * the largest preset (16 = 4x4) — if a workspace ever exceeds that, we keep
 * the largest layout rather than throwing.
 */
function findSmallestPresetFor(remaining: number): WorkspaceLayoutPreset {
  const presets = Object.keys(PRESET_LAYOUTS).map((k) => Number(k) as WorkspaceLayoutPreset).sort((a, b) => a - b)
  for (const preset of presets) {
    if (preset >= remaining) return preset
  }
  return presets[presets.length - 1]
}

function layoutToPreset(layout: WorkspaceLayout | undefined): WorkspaceLayoutPreset | null {
  if (!layout) return null
  const entry = Object.entries(PRESET_LAYOUTS).find(([, value]) => value === layout)
  return entry ? (Number(entry[0]) as WorkspaceLayoutPreset) : null
}

function positionKey(position: { rowIndex: number; columnIndex: number }): string {
  return `${position.rowIndex}:${position.columnIndex}`
}

function buildBindingMap(bindings: PaneAgentBinding[] | undefined): Map<number, PaneAgentBinding> {
  const map = new Map<number, PaneAgentBinding>()
  for (const b of bindings ?? []) map.set(b.paneIndex, b)
  return map
}
