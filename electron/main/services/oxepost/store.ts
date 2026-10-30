import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { coerceEnvironment, folderSegments, requestPathSegments } from '../../../../shared/oxepost/coerce'
import { parseRequest, serializeRequest, slugify } from '../../../../shared/oxepost/format'
import { ENVIRONMENTS_DIR, LIMITS, REQUESTS_DIR, REQUEST_EXTENSION, type PostEnvironment, type PostRequest, type PostRequestEntry } from '../../../../shared/oxepost/types'

/**
 * The collection of one workspace: request files and environment files under `<root>/.oxespace/requests`.
 * Callers pass relative paths with `/` separators; every one is validated segment by segment, resolved under the
 * collection folder, and checked again through the real path, so a link planted in the repository cannot lead a
 * read or a write outside the workspace. Environment files carry variable values and secret *names*, never secrets.
 */
export class RequestStore {
  readonly dir: string
  constructor(readonly root: string) { this.dir = join(root, ...REQUESTS_DIR.split('/')) }

  /** Verifies that the deepest existing ancestor of `target` really lives inside the workspace root. */
  private async assertInside(target: string): Promise<void> {
    const rel = relative(this.dir, target)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('The path is outside the requests folder')
    let probe = target
    for (;;) {
      try {
        const real = await realpath(probe)
        const inside = relative(await realpath(this.root), real)
        if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('The requests folder resolves outside the workspace')
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        const parent = dirname(probe)
        if (parent === probe) throw error
        probe = parent
      }
    }
  }

  private async fileFor(path: unknown): Promise<string> {
    const target = resolve(this.dir, ...requestPathSegments(path))
    await this.assertInside(target)
    return target
  }

  private async readText(file: string): Promise<string> {
    const info = await lstat(file)
    if (!info.isFile()) throw new Error('This is not a request file')
    if (info.size > LIMITS.requestFileBytes) throw new Error('The request file is too large')
    return readFile(file, 'utf8')
  }

  async list(): Promise<{ requests: PostRequestEntry[]; environments: PostEnvironment[] }> {
    const requests: PostRequestEntry[] = []
    const walk = async (directory: string, segments: string[]): Promise<void> => {
      let entries
      try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        if (requests.length >= LIMITS.entries) return
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) {
          if (segments.length === 0 && entry.name === ENVIRONMENTS_DIR) continue
          if (segments.length + 1 < LIMITS.depth && /^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(entry.name)) await walk(join(directory, entry.name), [...segments, entry.name])
        } else if (entry.isFile() && entry.name.endsWith(REQUEST_EXTENSION) && /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(entry.name)) {
          const path = [...segments, entry.name].join('/')
          try {
            const parsed = parseRequest(await this.readText(join(directory, entry.name)))
            requests.push({ path, name: parsed.name, method: parsed.method, folder: segments.join('/') })
          } catch (error) {
            requests.push({ path, name: entry.name.slice(0, -REQUEST_EXTENSION.length), method: null, folder: segments.join('/'), problem: error instanceof Error ? error.message : String(error) })
          }
        }
      }
    }
    await this.assertInside(this.dir).catch(() => undefined)
    await walk(this.dir, [])
    return { requests, environments: await this.listEnvironments() }
  }

  async read(path: unknown): Promise<PostRequest> {
    return parseRequest(await this.readText(await this.fileFor(path)))
  }

  /** Writes a request. With a path it replaces that file; without one it creates `<folder>/<slug>.http`, never over another file. */
  async save(path: unknown, request: PostRequest, folder?: unknown): Promise<string> {
    const text = serializeRequest(request)
    if (Buffer.byteLength(text) > LIMITS.requestFileBytes) throw new Error('The request is too large to save')
    if (path !== undefined && path !== null && path !== '') {
      const file = await this.fileFor(path)
      await this.atomicWrite(file, text)
      return (path as string)
    }
    const segments = folderSegments(folder)
    const base = slugify(request.name)
    for (let attempt = 1; attempt < 1000; attempt++) {
      const name = `${base}${attempt === 1 ? '' : `-${attempt}`}${REQUEST_EXTENSION}`
      const relativePath = [...segments, name].join('/')
      const file = await this.fileFor(relativePath)
      await mkdir(dirname(file), { recursive: true })
      try { await writeFile(file, text, { flag: 'wx' }); return relativePath } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
    throw new Error('Too many requests with this name')
  }

  /** Renames the request and its file (the slug follows the name). Returns the new path. */
  async rename(path: unknown, name: string): Promise<string> {
    const file = await this.fileFor(path)
    const request = { ...parseRequest(await this.readText(file)), name: name.trim() || 'Untitled' }
    const segments = requestPathSegments(path)
    const folder = segments.slice(0, -1)
    const current = segments[segments.length - 1]!.slice(0, -REQUEST_EXTENSION.length)
    const base = slugify(request.name)
    if (current === base || current.startsWith(`${base}-`) && /^\d+$/.test(current.slice(base.length + 1))) { await this.atomicWrite(file, serializeRequest(request)); return path as string }
    const created = await this.save(null, request, folder.join('/'))
    await rm(file)
    return created
  }

  async delete(path: unknown): Promise<void> {
    const file = await this.fileFor(path)
    const info = await lstat(file)
    if (!info.isFile()) throw new Error('This is not a request file')
    await rm(file)
  }

  private async atomicWrite(file: string, text: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`
    try { await writeFile(temporary, text, { flag: 'wx' }); await rename(temporary, file) } catch (error) { await rm(temporary, { force: true }); throw error }
  }

  // ---- environments -------------------------------------------------------------------------

  private envFile(id: string): string {
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(id)) throw new Error('The environment is not valid')
    return join(this.dir, ENVIRONMENTS_DIR, `${id}.json`)
  }

  async listEnvironments(): Promise<PostEnvironment[]> {
    let names: string[]
    try { names = (await readdir(join(this.dir, ENVIRONMENTS_DIR))).filter(name => name.endsWith('.json')).sort() } catch { return [] }
    const result: PostEnvironment[] = []
    for (const name of names.slice(0, 50)) {
      try {
        const id = name.slice(0, -5)
        const file = this.envFile(id)
        await this.assertInside(file)
        result.push({ ...coerceEnvironment(JSON.parse(await this.readText(file))), id })
      } catch { /* a file that is not an environment is not listed */ }
    }
    return result
  }

  async readEnvironment(id: string): Promise<PostEnvironment> {
    const file = this.envFile(id)
    await this.assertInside(file)
    return { ...coerceEnvironment(JSON.parse(await this.readText(file))), id }
  }

  /** Creates or replaces an environment; its id comes from its name, or is the one given when updating. */
  async saveEnvironment(value: unknown, id?: string): Promise<PostEnvironment> {
    const environment = coerceEnvironment(value)
    const final = id ?? slugify(environment.name)
    const file = this.envFile(final)
    await this.assertInside(file)
    const body = JSON.stringify({ name: environment.name, production: environment.production, variables: environment.variables, secrets: environment.secrets }, null, 2) + '\n'
    await this.atomicWrite(file, body)
    return { ...environment, id: final }
  }

  async deleteEnvironment(id: string): Promise<void> {
    const file = this.envFile(id)
    await this.assertInside(file)
    await rm(file, { force: true })
  }
}
