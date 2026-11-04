/* OxeCode workspaces, as in 1.4: one card per folder (a repository or one of its worktrees), each with its own panes.
   T85: each workspace has a color the user picks in Workspace settings; the default comes from a fixed palette whose
   text color reaches AA (4.5:1) on the surface in both themes (tokens --ws-1 … --ws-8 in mandacaru-1.5.css). */
export interface Workspace { id: string; name: string; path: string; project: string; branch: string; wt?: string; color: number }

/** The fixed palette. Names are what the color picker shows. */
export const WS_COLORS: [number, string][] = [[1, 'Caatinga'], [2, 'Sertão'], [3, 'Açude'], [4, 'Juazeiro'], [5, 'Xique-xique'], [6, 'Barro'], [7, 'Fim de tarde'], [8, 'Pedra']]

export const WORKSPACES: Workspace[] = [
  { id: 'w-api', name: 'cajui-api', path: '~/code/cajui/cajui-api', project: 'api', branch: 'main', color: 1 },
  { id: 'w-t142', name: 'cajui-api · t142', path: '~/.oxespace/worktrees/cajui-api/t142', project: 'api', branch: 'oxe/t142-idempotent-charges', wt: 't142', color: 3 },
  { id: 'w-t143', name: 'cajui-api · t143', path: '~/.oxespace/worktrees/cajui-api/t143', project: 'api', branch: 'mig-prd', wt: 't143', color: 7 },
  { id: 'w-web', name: 'cajui-web', path: '~/code/cajui/cajui-web', project: 'web', branch: 'main', color: 4 },
  { id: 'w-infra', name: 'cajui-infra', path: '~/code/cajui/cajui-infra', project: 'infra', branch: 'main', color: 6 }
]
/** The workspace a project or worktree lives in, for carrying its color into OxeChat, Agora and the status bar. */
export function wsFor (project: string, wt?: string | null): Workspace | undefined {
  return WORKSPACES.find(w => w.project === project && (wt ? w.wt === wt : !w.wt)) || WORKSPACES.find(w => w.project === project && !w.wt)
}
/** Conversations whose worktree is open as its own OxeCode workspace. */
export const TASK_WT: Record<string, string> = { t142: 't142', t143: 't143' }
/** The chat projects use the project's main workspace color. */
export const projColor = (project: string) => wsFor(project)?.color ?? 8
