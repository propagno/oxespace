import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../db/index'
import type {
  CreateWorkspaceInput,
  PaneStatus,
  PaneType,
  Workspace,
  WorkspaceDensity,
  WorkspaceLayout,
  WorkspaceLayoutPreset,
  WorkspaceThemeId,
  UpdateWorkspaceSettingsInput,
  UpdateWorkspaceEditorStateInput,
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
}

interface PaneRow {
  id: string
  workspace_id: string
  type: PaneType
  row_index: number
  column_index: number
  shell_profile_id: string | null
  status: PaneStatus
}

const DEFAULT_SHELL_PROFILE_ID = 'builtin-claude'
const DEFAULT_THEME_ID: WorkspaceThemeId = 'midnight'
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
          (id, workspace_id, type, row_index, column_index, shell_profile_id, status)
         VALUES
          (@id, @workspaceId, 'terminal', @rowIndex, @columnIndex, @shellProfileId, 'idle')`
      )

      for (const position of getPanePositions(layout)) {
        insertPane.run({
          id: randomUUID(),
          workspaceId,
          rowIndex: position.rowIndex,
          columnIndex: position.columnIndex,
          shellProfileId
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
          editor_visible, editor_expanded, editor_width_percent
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
          editor_visible, editor_expanded, editor_width_percent
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

  closePane(id: string): void {
    this.db.prepare('DELETE FROM panes WHERE id = ?').run(id)
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
          `INSERT INTO panes (id, workspace_id, type, row_index, column_index, shell_profile_id, status)
           VALUES (@id, @workspaceId, @type, @rowIndex, @columnIndex, @shellProfileId, 'idle')`
        )
        .run({
          id: randomUUID(),
          workspaceId: paneRow.workspace_id,
          type: paneRow.type,
          rowIndex: targetRow,
          columnIndex: targetCol,
          shellProfileId: paneRow.shell_profile_id
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
      panes: this.listPanes(row.id)
    }
  }

  private listPanes(workspaceId: string): WorkspacePane[] {
    const rows = this.db
      .prepare(
        `SELECT id, workspace_id, type, row_index, column_index, shell_profile_id, status
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
      status: row.status
    }))
  }
}

function clampEditorWidth(width: number): number {
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

function layoutToPreset(layout: WorkspaceLayout | undefined): WorkspaceLayoutPreset | null {
  if (!layout) return null
  const entry = Object.entries(PRESET_LAYOUTS).find(([, value]) => value === layout)
  return entry ? (Number(entry[0]) as WorkspaceLayoutPreset) : null
}

function positionKey(position: { rowIndex: number; columnIndex: number }): string {
  return `${position.rowIndex}:${position.columnIndex}`
}
