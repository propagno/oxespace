/**
 * The project's development servers, for the Browser: what to run so the page is up, and where it will answer.
 * Read from `.claude/launch.json` when the project has one (the file Claude Code writes, so both tools share it), then
 * from the scripts of `package.json`. Nothing here runs anything: the person starts a server from the Browser, seeing
 * the command first.
 */

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

export interface DevServerConfig {
  /** Stable within a project: `launch:<name>` or `package:<script>`. */
  id: string
  name: string
  /** The command line to run, or null for a server the person already runs (a launch entry with only a URL). */
  command: string | null
  /** Folder to run in, relative to the project root; null for the root. */
  cwd: string | null
  port: number | null
  /** Where the page is expected. The address the server prints, when it prints one, wins over this. */
  url: string
  origin: 'launch' | 'package'
}

/** What a dev server listens on when its script does not say. */
const DEFAULT_PORTS: Array<{ dependency: string; word: string; port: number }> = [
  { dependency: 'next', word: 'next', port: 3000 }, { dependency: 'nuxt', word: 'nuxt', port: 3000 }, { dependency: 'astro', word: 'astro', port: 4321 },
  { dependency: '@sveltejs/kit', word: 'vite', port: 5173 }, { dependency: 'vite', word: 'vite', port: 5173 }, { dependency: '@angular/cli', word: 'ng', port: 4200 },
  { dependency: 'react-scripts', word: 'react-scripts', port: 3000 }, { dependency: 'gatsby', word: 'gatsby', port: 8000 }, { dependency: '@remix-run/dev', word: 'remix', port: 5173 },
  { dependency: '@vue/cli-service', word: 'vue-cli-service', port: 8080 }, { dependency: 'webpack-dev-server', word: 'webpack', port: 8080 }, { dependency: 'parcel', word: 'parcel', port: 1234 },
  { dependency: 'expo', word: 'expo', port: 8081 }
]
/** Scripts that start a server, the usual one first. */
const SERVER_SCRIPTS = ['dev', 'start', 'serve', 'develop', 'preview', 'storybook']
const SCRIPT_PORTS: Record<string, number> = { storybook: 6006 }

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const parse = (text: string | null | undefined): Record<string, unknown> | null => { if (!text) return null; try { return record(JSON.parse(stripJsonComments(text))) } catch { return null } }
const port = (value: unknown): number | null => { const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value; return typeof n === 'number' && Number.isInteger(n) && n > 0 && n < 65536 ? n : null }

/** launch.json is often written with comments and trailing commas, as VS Code's is. */
export function stripJsonComments(text: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inString) { out += char; if (char === '\\') { out += text[++i] ?? '' } else if (char === '"') inString = false; continue }
    if (char === '"') { inString = true; out += char; continue }
    if (char === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue }
    if (char === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue }
    out += char
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

/** By the lock file the project keeps; npm when it keeps none. */
export function packageManagerFor(files: readonly string[]): PackageManager {
  const names = new Set(files.map(file => file.toLowerCase()))
  if (names.has('pnpm-lock.yaml')) return 'pnpm'
  if (names.has('yarn.lock')) return 'yarn'
  if (names.has('bun.lockb') || names.has('bun.lock')) return 'bun'
  return 'npm'
}

/** One argument of a command line: quoted only when it needs to be. */
function argument(value: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, '\\$1')}"`
}

/** A folder inside the project, forward slashes, or null (the root, or a path that leaves the project). */
function insideProject(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '')
  if (!normalized || normalized === '.' || /^([A-Za-z]:|\/)/.test(normalized) || normalized.split('/').some(part => part === '..' || part === '')) return null
  return normalized
}

/** Only this machine: a launch file of a repository does not get to send the Browser elsewhere. */
function loopbackUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null
    return url.toString()
  } catch { return null }
}

function fromLaunch(launch: Record<string, unknown>): DevServerConfig[] {
  const out: DevServerConfig[] = []
  for (const raw of Array.isArray(launch.configurations) ? launch.configurations.slice(0, 12) : []) {
    const config = record(raw)
    const name = config && typeof config.name === 'string' ? config.name.trim().slice(0, 60) : ''
    if (!config || !name || out.some(item => item.name === name)) continue
    const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 300).slice(0, 24) : []
    const executable = typeof config.runtimeExecutable === 'string' && config.runtimeExecutable.trim() ? config.runtimeExecutable.trim() : null
    const program = typeof config.program === 'string' && config.program.trim() ? config.program.trim() : null
    const command = executable ? [executable, ...strings(config.runtimeArgs)].map(argument).join(' ')
      : program ? ['node', program, ...strings(config.args)].map(argument).join(' ')
        : null
    const listens = port(config.port)
    const url = loopbackUrl(config.url) ?? `http://localhost:${listens ?? 3000}`
    if (!command && !loopbackUrl(config.url)) continue
    out.push({ id: `launch:${name}`, name, command, cwd: insideProject(config.cwd), port: listens ?? (command ? 3000 : null), url, origin: 'launch' })
  }
  return out
}

function fromPackage(pkg: Record<string, unknown>, manager: PackageManager): DevServerConfig[] {
  const scripts = record(pkg.scripts)
  if (!scripts) return []
  const dependencies = { ...record(pkg.dependencies), ...record(pkg.devDependencies) }
  const out: DevServerConfig[] = []
  for (const name of SERVER_SCRIPTS) {
    const script = scripts[name]
    if (typeof script !== 'string' || !script.trim()) continue
    // A "start" that only runs a built file is a production start, not what a person previews while editing.
    if (name === 'start' && out.length > 0) continue
    const said = /(?:--port[= ]|-p |\bPORT=)(\d{2,5})\b/.exec(script)?.[1]
    const words = script.split(/[\s&|;]+/).map(word => word.replace(/^.*[\\/]/, ''))
    const tool = DEFAULT_PORTS.find(item => words.includes(item.word)) ?? DEFAULT_PORTS.find(item => item.dependency in dependencies)
    const listens = port(said) ?? SCRIPT_PORTS[name] ?? tool?.port ?? 3000
    const command = manager === 'npm' ? `npm run ${argument(name)}` : `${manager} ${name === 'start' && manager === 'yarn' ? 'start' : `run ${argument(name)}`}`
    out.push({ id: `package:${name}`, name, command, cwd: null, port: listens, url: `http://localhost:${listens}`, origin: 'package' })
  }
  return out.slice(0, 4)
}

/** The servers of a project: the launch file's first (the person or an agent wrote them on purpose), then the package scripts. */
export function detectDevServers(input: { launchJson?: string | null; packageJson?: string | null; packageManager?: PackageManager }): DevServerConfig[] {
  const launch = parse(input.launchJson)
  const pkg = parse(input.packageJson)
  const fromFile = launch ? fromLaunch(launch) : []
  const fromScripts = pkg ? fromPackage(pkg, input.packageManager ?? 'npm') : []
  return [...fromFile, ...fromScripts.filter(script => !fromFile.some(item => item.command === script.command))]
}

/** `autoVerify` of the launch file: true unless the file says false (Claude Code's default). Null when there is no file. */
export function launchAutoVerify(launchJson: string | null | undefined): boolean | null {
  const launch = parse(launchJson)
  return launch ? launch.autoVerify !== false : null
}

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g

/**
 * The address a dev server printed ("Local: http://localhost:5173/"), from its output: the first one on this machine.
 * A server that found its port taken says so in words and prints only the address it took.
 */
export function urlFromOutput(output: string): string | null {
  const text = output.replace(ANSI, '')
  const match = /https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d{2,5})?(\/[^\s"'<>)\]]*)?/.exec(text)
  if (!match) return null
  const host = match[1] === '0.0.0.0' ? 'localhost' : match[1]
  const path = (match[3] ?? '/').replace(/[.,;:]+$/, '') || '/'
  return `${match[0].startsWith('https') ? 'https' : 'http'}://${host}${match[2] ?? ''}${path}`
}
