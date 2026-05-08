import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../db/index'
import type {
  CreateWorkspaceInput,
  PaneStatus,
  PaneType,
  Workspace,
  WorkspaceLayout,
  UpdateWorkspaceEditorStateInput,
  WorkspacePane
} from '../../../shared/types/workspace'

interface WorkspaceRow {
  id: string
  name: string
  root_path: string
  layout: WorkspaceLayout
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

export class WorkspaceService {
  constructor(private readonly db: AppDatabase) {}

  create(input: CreateWorkspaceInput): Workspace {
    const layout = input.layout
    const workspaceId = randomUUID()
    const shellProfileId = input.defaultShellProfileId ?? DEFAULT_SHELL_PROFILE_ID
    const name = input.name?.trim() || basename(input.rootPath)
    const autoStart = input.autoStart !== false

    const createWorkspace = this.db.transaction(() => {
      this.db.prepare('UPDATE workspaces SET is_active = 0').run()
      this.db
        .prepare(
          `INSERT INTO workspaces
            (id, name, root_path, layout, default_shell_profile_id, auto_start, is_active)
           VALUES
            (@id, @name, @rootPath, @layout, @defaultShellProfileId, @autoStart, 1)`
        )
        .run({
          id: workspaceId,
          name,
          rootPath: input.rootPath,
          layout,
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
        `SELECT id, name, root_path, layout, default_shell_profile_id, auto_start, is_active,
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
        `SELECT id, name, root_path, layout, default_shell_profile_id, auto_start, is_active,
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
        this.db.prepare('UPDATE workspaces SET layout = ? WHERE id = ?').run(newLayout, paneRow.workspace_id)
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
  '2x1': '2x2'
}

const LAYOUT_UPGRADE_HORIZONTAL: Partial<Record<WorkspaceLayout, WorkspaceLayout>> = {
  '1x1': '2x1',
  '1x2': '2x2'
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
