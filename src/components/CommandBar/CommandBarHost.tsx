import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { CommandContext, CommandRequestItem, ParsedCommandLine } from '../../../shared/command-bar'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import type { AppView } from '../../keyboard/keybindings'
import { useSkillStore } from '../../store/skill.store'
import { useThreadStore } from '../../store/thread.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { CommandBar } from './CommandBar'

export interface CommandBarHostProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  applicationView: AppView
  selectMode: (mode: AppView) => void
  activeWorkspace: Workspace | null
  activePane: WorkspacePane | null
}

export function CommandBarHost({
  open,
  onOpenChange,
  applicationView,
  selectMode,
  activeWorkspace,
  activePane
}: CommandBarHostProps): ReactElement {
  const skills = useSkillStore(state => state.skills)
  const workspaces = useWorkspaceStore(state => state.workspaces)
  const setActiveWorkspace = useWorkspaceStore(state => state.setActiveWorkspace)
  const snapshot = useThreadStore(state => state.snapshot)
  const projects = useThreadStore(state => state.projects)
  const [requests, setRequests] = useState<CommandRequestItem[]>([])

  useEffect(() => {
    if (!open) return
    let alive = true
    window.oxe?.thread?.pendingRequestsAll?.()
      .then(items => {
        if (!alive) return
        setRequests((items ?? []).map(item => ({
          workspaceId: item.workspaceId,
          threadId: item.threadId,
          requestId: item.requestId
        })))
      })
      .catch(() => {
        if (alive) setRequests([])
      })
    return () => { alive = false }
  }, [open])

  const context = useMemo<CommandContext>(() => {
    const workspaceId = applicationView === 'thread'
      ? (snapshot?.thread.workspaceId ?? activeWorkspace?.id ?? '')
      : (activeWorkspace?.id ?? snapshot?.thread.workspaceId ?? '')
    const pane = activePane
      ? { id: activePane.id, agent: Boolean(activePane.agentProfileId || activePane.agentName) }
      : undefined
    return {
      workspaceId,
      threadId: snapshot?.thread.id,
      pane,
      enabledSkills: skills.map(s => s.name),
      requests
    }
  }, [activePane, activeWorkspace?.id, applicationView, requests, skills, snapshot?.thread.id, snapshot?.thread.workspaceId])

  const handleRun = useCallback((parsed: ParsedCommandLine) => {
    if (parsed.kind === 'open') {
      const q = parsed.query.trim().toLowerCase()
      if (q === 'oxechat') { selectMode('thread'); return }
      if (q === 'oxecode') { selectMode('code'); return }
      if (q === 'oxequery') { selectMode('data'); return }
      const match = workspaces.find(ws => ws.name.toLowerCase() === q)
        ?? workspaces.find(ws => ws.name.toLowerCase().startsWith(q))
        ?? workspaces.find(ws => ws.name.toLowerCase().includes(q))
      if (match) {
        void setActiveWorkspace(match.id)
        selectMode('code')
      }
      return
    }

    if (parsed.kind === 'agent') {
      selectMode('thread')
      const threadApi = window.oxe?.thread
      if (!threadApi) return
      const project = projects.find(p => p.projectId === snapshot?.thread.projectId) ?? projects.find(p => !p.hidden)
      const rootPath = snapshot?.thread.rootPath ?? project?.contexts[0]?.rootPath ?? activeWorkspace?.rootPath
      const projectId = project?.projectId ?? activeWorkspace?.id
      if (!projectId || !rootPath) return
      void threadApi.create({ projectId, rootPath, provider: parsed.provider }).then(created => {
        useThreadStore.getState().adopt(created)
        if (parsed.text.trim()) {
          void threadApi.send(created.thread.id, parsed.text.trim())
        }
      })
    }
  }, [activeWorkspace?.id, activeWorkspace?.rootPath, projects, selectMode, setActiveWorkspace, snapshot?.thread.projectId, snapshot?.thread.rootPath, workspaces])

  return <CommandBar open={open} onOpenChange={onOpenChange} context={context} onRun={handleRun} />
}
