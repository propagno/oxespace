import { CircleDollarSign, FolderInput, FolderPlus, History, ListChecks, MessageSquarePlus, PencilLine, ScrollText, Undo2, UserRound } from 'lucide-react'
import type { ThreadProjectSummary, ThreadSnapshot } from '../../shared/types/thread'
import { useThreadStore } from '../store/thread.store'
import { toast } from '../ui'
import type { ContributedCommand } from '../utils/commandRegistry'
import { humanizeError } from '../utils/humanizeError'
import { navigableThreads } from '../utils/threadNavigation'
import { useCommandSource } from './useCommandSource'

/** ThreadView runs `{ text }` as if it was typed in the composer of the active conversation. */
export const THREAD_RUN_COMMAND_EVENT = 'oxe:thread-run-command'

export interface ThreadCommandContext {
  snapshot: ThreadSnapshot | null
  projects: ThreadProjectSummary[]
  /** Brings Thread to the front before a command acts on it. */
  showThread: () => void
  newThread: () => void
  newThreadIn: (projectId: string) => void
  addProject: () => void
  openAccounts: () => void
}

const CATEGORY = 'OxeChat'

/** Opens the project's latest conversation, or a new one when it has none. */
function switchProject(ctx: ThreadCommandContext, projectId: string): void {
  const { threads, hiddenProjects, select } = useThreadStore.getState()
  const latest = navigableThreads([...threads], hiddenProjects).find(thread => thread.projectId === projectId)
  if (latest) void select(latest.id)
  else ctx.newThreadIn(projectId)
}

/** Restores every file the last finished turn changed, as "Undo all" above the composer does. */
export async function undoLastTurn(snapshot: ThreadSnapshot): Promise<void> {
  const api = window.oxe?.thread
  const turn = [...(snapshot.turns ?? [])].reverse().find(item => item.status !== 'running')
  if (!api?.turnFiles || !api.undoTurnFile) return
  // Said, not silent: the palette only offers this after a finished turn, but the conversation may change under it.
  if (!turn) { toast({ title: 'Nothing to undo', description: 'This conversation has no finished turn yet.' }); return }
  const threadId = snapshot.thread.id
  try {
    const files = (await api.turnFiles(threadId, turn.id)).filter(file => file.state === 'pending')
    if (!files.length) { toast({ title: 'Nothing to undo', description: 'The last turn left no file changes to restore.' }); return }
    for (const file of files) await api.undoTurnFile(threadId, turn.id, file.path)
    toast({ title: `Restored ${files.length} ${files.length === 1 ? 'file' : 'files'}`, intent: 'success' })
  } catch (cause) {
    toast({ title: 'Could not undo the last turn', description: humanizeError(cause, 'A file changed after the turn.'), intent: 'danger' })
  } finally {
    await useThreadStore.getState().refresh(threadId)
  }
}

/** Thread conversations, projects and the conversation commands of the composer, in the palette. */
export function buildThreadCommands(ctx: ThreadCommandContext): ContributedCommand[] {
  const { snapshot } = ctx
  const running = Boolean(snapshot?.turns?.some(turn => turn.status === 'running'))
  const finished = Boolean(snapshot?.turns?.some(turn => turn.status !== 'running'))
  const inThread = (run: () => void) => () => { ctx.showThread(); run() }
  const slash = (id: string, label: string, text: string, icon: ContributedCommand['icon'], keywords: string[] = []): ContributedCommand => ({
    id: `thread.${id}`, label, icon, category: CATEGORY, keywords: [text, ...keywords], detail: text, disabled: !snapshot,
    // After the view switch, so the active conversation is mounted and listening.
    run: inThread(() => requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(THREAD_RUN_COMMAND_EVENT, { detail: { text } }))))
  })
  return [
    { id: 'thread.new', label: 'New conversation', icon: MessageSquarePlus, category: CATEGORY, keywords: ['thread', 'chat', 'oxechat', 'start'], shortcut: 'thread.new', run: inThread(ctx.newThread) },
    { id: 'thread.add-project', label: 'Add OxeChat project…', icon: FolderPlus, category: CATEGORY, keywords: ['folder', 'repository'], run: inThread(ctx.addProject) },
    ...ctx.projects.filter(project => !project.hidden).map(project => ({
      id: `thread.project.${project.projectId}`, label: `Switch to project ${project.displayName}`, detail: project.identityLabel, icon: FolderInput,
      category: CATEGORY, keywords: ['project', 'change', project.displayName], run: inThread(() => switchProject(ctx, project.projectId))
    })),
    slash('resume', 'Resume a session', '/resume', History, ['sessions', 'continue', 'history']),
    slash('rename', 'Rename conversation', '/rename', PencilLine, ['title', 'name']),
    slash('spending', 'Conversation spending', '/spending', CircleDollarSign, ['cost', 'usage', 'tokens', 'money']),
    slash('events', 'Conversation events', '/events', ScrollText, ['log', 'debug']),
    slash('rules', 'Approval rules', '/rules', ListChecks, ['permissions', 'allow', 'deny']),
    { id: 'thread.undo-last-turn', label: 'Undo the last turn’s file changes', icon: Undo2, category: CATEGORY, keywords: ['revert', 'restore', 'checkpoint', 'rewind'],
      disabled: !snapshot || running || !finished, run: inThread(() => { if (snapshot) void undoLastTurn(snapshot) }) },
    { id: 'thread.accounts', label: 'Provider accounts', icon: UserRound, category: CATEGORY, keywords: ['login', 'logout', 'claude', 'codex', 'account'],
      // Accounts are checked inside a project.
      disabled: ctx.projects.length === 0, run: inThread(ctx.openAccounts) }
  ]
}

export function useThreadCommands(ctx: ThreadCommandContext): void {
  useCommandSource('thread', buildThreadCommands(ctx))
}
