import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { Workspace } from '../../../shared/types/workspace'
import type { CommandPaletteAction } from '../../utils/commandRegistry'
import { useEditorStore } from '../../store/editor.store'
import { useUIStore } from '../../store/ui.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { getKeyboardView, type AppView } from '../../keyboard/keybindings'
import { goToPane } from '../../commands/goTo'
import { CommandBarHost } from '../CommandBar/CommandBarHost'
import type { CommandBarPlace } from '../CommandBar/CommandBar'

interface CommandMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspace: Workspace | null
  /** The full command registry, listed after ">". */
  actions: CommandPaletteAction[]
  /** All open workspaces/worktrees, for jump-to. */
  workspaces: Workspace[]
  onSelectWorkspace: (id: string) => void
  /** Focus a pane (agent/terminal) in the active workspace. */
  onSelectPane: (paneId: string) => void
}

const splitPath = (p: string): { name: string; dir: string } => {
  const i = p.lastIndexOf('/')
  return { name: i >= 0 ? p.slice(i + 1) : p, dir: i >= 0 ? p.slice(0, i) : '' }
}

/** A view chosen the way the title bar's view buttons choose it: the window's own switch (and its pending state). */
function showView(view: AppView): void {
  document.querySelector<HTMLElement>(`[data-app-mode="${view}"]`)?.click()
}

/**
 * The palette shortcut (Ctrl+Shift+P, Ctrl+J) opens the one command bar (OXE-75, BRD-11 CA-4), with ">" typed so it
 * lists commands first. Clearing the ">" searches workspaces, conversations, panes and the workspace's file names.
 */
export function CommandMenu({
  open,
  onOpenChange,
  workspace,
  actions,
  workspaces,
  onSelectWorkspace,
  onSelectPane
}: CommandMenuProps): ReactElement {
  const { t } = useTranslation()
  const [fileList, setFileList] = useState<string[]>([])
  const activePaneId = useUIStore(state => state.activePaneId)

  useEffect(() => {
    if (!open) return
    if (!workspace) {
      setFileList([])
      return
    }
    // Snapshot the tracked file list once per open for name quick-open.
    let active = true
    Promise.resolve(window.oxe?.search?.listFiles?.({ workspaceId: workspace.id, rootPath: workspace.rootPath }))
      .then((r) => { if (active) setFileList(Array.isArray(r?.files) ? r.files : []) })
      .catch(() => { if (active) setFileList([]) })
    return () => { active = false }
  }, [open, workspace])

  const openFile = useCallback(
    (path: string) => {
      if (!workspace) return
      void useEditorStore
        .getState()
        .openFile({ workspaceId: workspace.id, rootPath: workspace.rootPath, relativePath: path })
      void useWorkspaceStore.getState().updateEditorState({ workspaceId: workspace.id, editorVisible: true })
    },
    [workspace]
  )

  const runAction = (id: string): void => { actions.find(action => action.id === id && !action.disabled)?.run() }

  const places = useMemo<CommandBarPlace[]>(() => {
    const panes = workspace?.panes ?? []
    const panesLabel = t('commandBar.groups.panes')
    const filesLabel = t('commands.menu.files')
    return [
      ...panes.map(pane => {
        const text = goToPane(pane, panes)
        return { key: `pane-${pane.id}`, group: panesLabel, primary: text.name, secondary: text.detail, words: `${text.label} ${pane.agentName ?? ''}`, run: () => onSelectPane(pane.id) }
      }),
      ...fileList.map(path => {
        const { name, dir } = splitPath(path)
        return { key: `file-${path}`, group: filesLabel, primary: name, secondary: dir, title: path, words: path, run: () => openFile(path) }
      })
    ]
  }, [fileList, onSelectPane, openFile, t, workspace])

  const activePane = workspace?.panes.find(pane => pane.id === activePaneId) ?? null

  return (
    <CommandBarHost
      open={open}
      onOpenChange={onOpenChange}
      applicationView={getKeyboardView()}
      selectMode={showView}
      activeWorkspace={workspace}
      activePane={activePane}
      onNewTerminal={() => runAction('split-vertical')}
      onNewConversation={() => runAction('thread.new')}
      actions={actions}
      workspaces={workspaces}
      places={places}
      onSelectWorkspace={onSelectWorkspace}
      placeholder={t('commands.menu.placeholder')}
      initialQuery=">"
    />
  )
}
