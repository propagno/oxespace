import { isAbsolute } from 'node:path'

export type ComposeAction = 'up' | 'down' | 'start' | 'stop' | 'restart' | 'logs'
export const COMPOSE_ACTIONS: ReadonlySet<string> = new Set<ComposeAction>(['up', 'down', 'start', 'stop', 'restart', 'logs'])

export interface ComposeTarget { project: string; directory: string; files: string[] }

const PROJECT = /^[a-z0-9][a-z0-9_-]{0,63}$/

/**
 * Where a Compose project lives, read from the labels the engine put on one of its containers
 * (`docker inspect`). The directory and files come from there and nowhere else: a page can name a
 * container, never a path to run in.
 */
export function composeTarget(inspectJson: string): ComposeTarget | null {
  let labels: Record<string, string> | undefined
  try {
    const parsed = JSON.parse(inspectJson) as Array<{ Config?: { Labels?: Record<string, string> } }>
    labels = parsed[0]?.Config?.Labels
  } catch { return null }
  if (!labels) return null
  const project = labels['com.docker.compose.project'] ?? labels['io.podman.compose.project']
  const directory = labels['com.docker.compose.project.working_dir'] ?? labels['io.podman.compose.project.working_dir']
  const files = (labels['com.docker.compose.project.config_files'] ?? '').split(',').map(entry => entry.trim()).filter(Boolean)
  if (!project || !PROJECT.test(project) || !directory || !isAbsolute(directory) || /\0/.test(directory)) return null
  if (files.some(file => !isAbsolute(file) || /\0/.test(file) || !/\.ya?ml$/i.test(file))) return null
  return { project, directory, files }
}

/** The arguments after the engine's own: one `compose` call, scoped to the project, never a shell string. */
export function composeArgs(target: ComposeTarget, action: ComposeAction, tail = 200): string[] {
  const base = ['compose', '--project-name', target.project, '--project-directory', target.directory, ...target.files.flatMap(file => ['-f', file])]
  switch (action) {
    case 'up': return [...base, 'up', '-d']
    case 'down': return [...base, 'down']
    case 'logs': return [...base, 'logs', '--no-color', '--timestamps', '--tail', String(Math.max(1, Math.min(Math.trunc(tail) || 200, 500)))]
    default: return [...base, action]
  }
}
