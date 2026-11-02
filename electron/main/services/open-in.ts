import { spawn } from 'node:child_process'
import { accessSync, constants, readFileSync, statSync, writeFileSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { mainMessage } from '../../../shared/messages'
import {
  OPEN_IN_EDITOR_NAMES, OPEN_IN_EDITORS, OPEN_IN_MAX_POSITION, isOpenInPreference, isOpenInTarget,
  type OpenInEditor, type OpenInEditorId, type OpenInInput, type OpenInPreference, type OpenInTargets
} from '../../../shared/types/open-in'
import { MainMessageError } from '../ipc/main-message-error'

/**
 * B18 · "Abrir em…". Loaded on first use (`app:open-in*`), so editor detection costs the main entry nothing.
 *
 * What the window sends never becomes a command line: the path must resolve, links followed, inside the workspace's
 * registered root; the editor is one main found itself in fixed install places (Windows) or as an exact name on an
 * absolute PATH entry (Linux); and it starts with an argument list, never through a shell.
 */

/** The workspace root main has registered for an id, or null; the same resolver the file system channels use. */
export type OpenInRootResolver = (workspaceId: string, requestedRoot: string) => string | null

export interface OpenInDeps {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  resolveRoot: OpenInRootResolver
  /** Where the preferred editor is kept (userData/open-in.json). */
  preferenceFile: string
  /** Starts `file` with `args` and no shell; resolves once it started, rejects if it could not. */
  launch(file: string, args: string[], cwd: string): Promise<void>
  reveal(path: string): void
  /** Whether `path` is an executable file (POSIX: the x bit; Windows: a file). */
  isExecutable?(path: string): boolean
}

const WINDOWS_INSTALLS: Record<OpenInEditorId, string[]> = {
  vscode: ['Microsoft VS Code\\Code.exe'],
  cursor: ['cursor\\Cursor.exe', 'Cursor\\Cursor.exe'],
  zed: ['Zed\\Zed.exe']
}
const POSIX_NAMES: Record<OpenInEditorId, string[]> = { vscode: ['code'], cursor: ['cursor'], zed: ['zed', 'zeditor'] }

/**
 * Whether `path` is an editor main may start. POSIX also asks who could have put it there: the file must belong to
 * root or the person, in a folder other users can't write to (a world-writable PATH entry, like /tmp, without the
 * sticky bit), so another account on the machine can't plant the "editor" (SECURITY #454 L).
 */
export function trustedExecutable(path: string, platform: NodeJS.Platform, uid = process.getuid?.()): boolean {
  try {
    const file = statSync(path)
    if (!file.isFile()) return false
    if (platform === 'win32') return true
    accessSync(path, constants.X_OK)
    if (file.uid !== 0 && file.uid !== uid) return false
    if (file.mode & 0o002) return false
    const folder = statSync(dirname(path))
    return !(folder.mode & 0o002) || !!(folder.mode & 0o1000)
  } catch { return false }
}

function defaultIsExecutable(platform: NodeJS.Platform) {
  return (path: string): boolean => trustedExecutable(path, platform)
}

/** The places an editor's executable may be, most likely first. Only absolute places; nothing from the window. */
export function editorCandidates(id: OpenInEditorId, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'win32') {
    const bases = [env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs'), env.ProgramFiles, env['ProgramFiles(x86)']]
      .filter((base): base is string => !!base && isAbsolute(base))
    return bases.flatMap(base => WINDOWS_INSTALLS[id].map(rest => join(base, rest)))
  }
  if (platform === 'linux') {
    const dirs = (env.PATH ?? '').split(delimiter).filter(dir => dir && isAbsolute(dir))
    return [...new Set(dirs.flatMap(dir => POSIX_NAMES[id].map(name => join(dir, name))))]
  }
  // macOS comes later (F33 §7): no editor is listed there yet; reveal still works.
  return []
}

/** The env an editor starts with: never the app's own run-as-Node switch, Node options or OXESpace's variables. */
export function editorEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => {
    const upper = key.toUpperCase()
    return upper !== 'ELECTRON_RUN_AS_NODE' && upper !== 'NODE_OPTIONS' && !upper.startsWith('OXESPACE_')
  }))
}

/** The argument list for an editor: at the line (and column) when there is one. The file is always absolute. */
/** Whether a path has a ":" past its drive letter (a Linux name, or a Windows stream), which editors may read as :line. */
export function hasNameColon(file: string): boolean {
  return file.slice(/^[A-Za-z]:/.test(file) ? 2 : 0).includes(':')
}

export function editorArgs(id: OpenInEditorId, file: string, line?: number, column?: number): string[] {
  // A name with ":" would be misread as file:line, so such a file opens at the top (BACKEND #454).
  if (line === undefined || hasNameColon(file)) return [file]
  const at = `${file}:${line}:${column ?? 1}`
  return id === 'zed' ? [at] : ['--goto', at]
}

function refuse(code: 'app.openIn.outsideRoot' | 'app.openIn.unknownTarget' | 'app.openIn.revealFailed', text: string): never {
  throw new MainMessageError(mainMessage(code, {}), text)
}

function inside(root: string, target: string): boolean {
  const base = normalize(root)
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`
  return target === base || target.startsWith(prefix)
}

/**
 * The as-written check: on Windows a path typed in another case than the root still names a place inside it. Only a
 * pre-check; the decision is `inside` on two real paths, which carry the true case (BACKEND #454).
 */
function insideAsWritten(root: string, target: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' ? inside(root.toLowerCase(), target.toLowerCase()) : inside(root, target)
}

function position(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > OPEN_IN_MAX_POSITION) throw new Error(`Invalid ${name}`)
  return value
}

/** The input's shape; malformed input stays a plain Error, an unknown target is refused by its C3 code. */
export function parseOpenInInput(value: unknown): OpenInInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid app:open-in input')
  const input = value as Record<string, unknown>
  const text = (field: string, max: number): string => {
    const raw = input[field]
    if (typeof raw !== 'string' || !raw || raw.length > max || raw.includes('\0')) throw new Error(`Invalid ${field}`)
    return raw
  }
  const workspaceId = text('workspaceId', 512)
  const rootPath = text('rootPath', 4096)
  const path = text('path', 4096)
  const line = position(input.line, 'line')
  const column = line === undefined ? undefined : position(input.column, 'column')
  if (!isOpenInTarget(input.target)) refuse('app.openIn.unknownTarget', 'Unknown open-in target')
  return { workspaceId, rootPath, path, line, column, target: input.target }
}

export class OpenInService {
  private readonly isExecutable: (path: string) => boolean

  constructor(private readonly deps: OpenInDeps) {
    this.isExecutable = deps.isExecutable ?? defaultIsExecutable(deps.platform)
  }

  /** The editors installed now, each at the first place it was found. Read again on every call. */
  detect(): Array<OpenInEditor & { executable: string }> {
    const found: Array<OpenInEditor & { executable: string }> = []
    for (const id of OPEN_IN_EDITORS) {
      const executable = editorCandidates(id, this.deps.platform, this.deps.env).find(this.isExecutable)
      if (executable) found.push({ id, name: OPEN_IN_EDITOR_NAMES[id], executable })
    }
    return found
  }

  targets(): OpenInTargets {
    return { editors: this.detect().map(({ id, name }) => ({ id, name })), preferred: this.preference() }
  }

  preference(): OpenInPreference {
    try {
      const value: unknown = JSON.parse(readFileSync(this.deps.preferenceFile, 'utf8'))?.preferred
      return isOpenInPreference(value) ? value : 'auto'
    } catch { return 'auto' }
  }

  setPreference(value: unknown): OpenInTargets {
    if (!isOpenInPreference(value)) throw new Error('Invalid open-in preference')
    try { writeFileSync(this.deps.preferenceFile, JSON.stringify({ preferred: value })) } catch { /* not saved: the next read falls back to auto */ }
    return { ...this.targets(), preferred: value }
  }

  /**
   * The file's real path, inside the workspace's registered root. A path outside the root, as written or once its
   * links are followed, is `outsideRoot`; one that resolves inside but doesn't exist is `notFound`.
   */
  async resolveFile(input: Pick<OpenInInput, 'workspaceId' | 'rootPath' | 'path'>): Promise<{ file: string; root: string }> {
    const registered = this.deps.resolveRoot(input.workspaceId, input.rootPath)
    if (!registered) refuse('app.openIn.outsideRoot', 'The workspace is not open')
    let root: string
    try {
      root = await realpath(resolve(registered))
      if (await realpath(resolve(input.rootPath)) !== root) refuse('app.openIn.outsideRoot', 'The root does not match the workspace')
    } catch (cause) {
      if (cause instanceof MainMessageError) throw cause
      refuse('app.openIn.outsideRoot', 'The workspace root is not reachable')
    }
    const written = resolve(root, input.path)
    // As written first: a path that names a place outside never reports whether it exists.
    if (!insideAsWritten(root, written, this.deps.platform) && !insideAsWritten(resolve(registered), written, this.deps.platform)) refuse('app.openIn.outsideRoot', 'Path outside the workspace')
    let file: string
    try {
      file = await realpath(written)
    } catch {
      const shown = relative(root, written) || '.'
      throw new MainMessageError(mainMessage('app.openIn.notFound', { path: shown }), 'The file no longer exists')
    }
    if (!inside(root, file)) refuse('app.openIn.outsideRoot', 'Path resolves outside the workspace')
    return { file, root }
  }

  async open(raw: unknown): Promise<void> {
    const input = parseOpenInInput(raw)
    const { file, root } = await this.resolveFile(input)
    if (input.target === 'reveal') {
      try { this.deps.reveal(file) } catch { refuse('app.openIn.revealFailed', 'Could not show the file in its folder') }
      return
    }
    const name = OPEN_IN_EDITOR_NAMES[input.target]
    // Files only: an editor opening a folder may run the tasks an agent wrote there on folder open (SECURITY #454 L).
    // A folder can still be shown in the system's file manager.
    if (!(await stat(file)).isFile()) throw new MainMessageError(mainMessage('app.openIn.notAFile', { editor: name }), 'Only files open in an editor')
    const editor = this.detect().find(found => found.id === input.target)
    if (!editor) throw new MainMessageError(mainMessage('app.openIn.editorMissing', { editor: name }), 'The editor is not installed')
    // Zed reads path:row from any argument, so "x:12" would open "x", possibly a link out (SECURITY #454 L).
    if (editor.id === 'zed' && hasNameColon(file)) throw new MainMessageError(mainMessage('app.openIn.launchFailed', { editor: name }), 'Zed would misread this file name')
    try {
      await this.deps.launch(editor.executable, editorArgs(editor.id, file, input.line, input.column), root)
    } catch {
      throw new MainMessageError(mainMessage('app.openIn.launchFailed', { editor: name }), 'The editor did not start')
    }
  }
}

/** Starts an editor detached, with an argument list and no shell; settles on the process's spawn or error. */
export function launchDetached(file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(file, args, { cwd, env: editorEnv(env), detached: true, stdio: 'ignore', shell: false, windowsHide: false })
    child.once('error', fail)
    child.once('spawn', () => { child.unref(); done() })
  })
}
