import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import type { SemanticStatus } from '../../../shared/types/ipc'
import type { SemanticService } from './semantic.service'

type Index = Pick<SemanticService, 'setEnabled' | 'isEnabled' | 'getStatus'>

const normalize = (root: string): string => {
  const unified = root.replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? unified.toLowerCase() : unified
}

/**
 * Semantic search for Thread projects that are not open in Code. It stays opt-in: a person turns it on in the
 * project's settings, the choice is saved here (one list of project roots), and the index starts when it is turned
 * on or the first time an agent of that project searches after a restart. Nothing is indexed at startup.
 */
export class SemanticProjects {
  private roots: Set<string> | null = null

  constructor(private readonly index: Index, private readonly file: string) {}

  /** The index id for a project root; Code workspaces keep their own ids. */
  static idFor(root: string): string { return `project:${normalize(root)}` }

  isOn(root: string): boolean { return this.saved().has(normalize(root)) }

  set(root: string, enabled: boolean): SemanticStatus {
    const roots = this.saved()
    if (enabled) roots.add(normalize(root)); else roots.delete(normalize(root))
    this.save(roots)
    this.index.setEnabled(SemanticProjects.idFor(root), enabled, root)
    return this.index.getStatus(SemanticProjects.idFor(root))
  }

  /** The index id to search for a project, starting it if it was turned on before a restart; null when it is off. */
  ensure(root: string): string | null {
    if (!this.isOn(root)) return null
    const id = SemanticProjects.idFor(root)
    if (!this.index.isEnabled(id)) this.index.setEnabled(id, true, root)
    return id
  }

  status(root: string): SemanticStatus {
    const id = this.ensure(root) ?? SemanticProjects.idFor(root)
    return this.index.getStatus(id)
  }

  private saved(): Set<string> {
    if (this.roots) return this.roots
    try {
      const value = JSON.parse(readFileSync(this.file, 'utf8')) as { roots?: unknown }
      this.roots = new Set(Array.isArray(value.roots) ? value.roots.filter((item): item is string => typeof item === 'string') : [])
    } catch { this.roots = new Set() }
    return this.roots
  }

  private save(roots: Set<string>): void {
    this.roots = roots
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify({ roots: [...roots].sort() }, null, 2))
  }
}

/** A Thread project's directory, as the app's own window sends it: absolute and existing. */
export function projectDirectory(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('A project directory is required')
  if (!statSync(value, { throwIfNoEntry: false })?.isDirectory()) throw new Error('This project directory is unavailable')
  return value
}

const instances = new WeakMap<object, SemanticProjects>()
let defaultFile: string | null = null

/** Where the list is saved; set once by the app at startup. */
export function setSemanticProjectsFile(file: string): void { defaultFile = file }

/** The project list for an index; one per index, so the IPC and the agent tools share it. */
export function semanticProjects(index: Index): SemanticProjects | null {
  const existing = instances.get(index)
  if (existing) return existing
  if (!defaultFile) return null
  const created = new SemanticProjects(index, defaultFile)
  instances.set(index, created)
  return created
}
