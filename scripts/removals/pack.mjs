// Adds the IMPLEMENTATION-PACK fields (TECH LEAD, 08/11) to the BACKEND F2 task lists: deleted_paths, edited_paths,
// created_paths, symbols (must exist after the task: new ones with their signature, plus at least one kept export of an
// edited file) and symbols_removed (must be gone). Run from the repo root on a checkout of origin/main:
//   node scripts/removals/pack.mjs <f2-removals-BACKEND.json> <f2-gaps-BACKEND.json>
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ITEMS } from './items.mjs'

const [removalsPath, gapsPath] = process.argv.slice(2)
const EXPORT = /^export\s+(?:default\s+)?(?:declare\s+)?(async\s+function|function|class|const|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm

/** The exported names of a source file, with a signature (the declaration line, without its body). */
function exportsOf(path) {
  if (!existsSync(path) || statSync(path).isDirectory() || !/\.(ts|tsx|js|cjs|mjs)$/.test(path)) return []
  const text = readFileSync(path, 'utf8')
  return [...text.matchAll(EXPORT)].map(match => {
    const line = text.slice(match.index, text.indexOf('\n', match.index) === -1 ? undefined : text.indexOf('\n', match.index))
    const kind = match[1].replace(/^async\s+/, '')
    const signature = line.replace(/\s*\{\s*$/, '').replace(/\s*=.*$/, kind === 'const' || kind === 'let' ? '' : '$&').trim()
    return { kind: kind === 'let' ? 'const' : kind, name: match[2], path, signature }
  })
}
/** Files a deleted path holds: the file itself, or the files directly in the folder (not the vendored CodeGraph). */
function deletedFiles(path) {
  if (!existsSync(path)) return []
  if (!statSync(path).isDirectory()) return [path]
  if (path.includes('vendor/codegraph')) return []
  return readdirSync(path).map(name => `${path}/${name}`).filter(file => !statSync(file).isDirectory())
}

const KEEP_PREFERENCE = ['shared/types/ipc.ts#IPC_CHANNELS', 'shared/mcp-coverage.ts#MCP_COVERAGE']
/** New exports per item, from the frozen tests' contracts. */
const NEW = {
  R0a: [
    { kind: 'function', name: 'projectIdentity', path: 'electron/main/services/project-identity.ts', signature: 'export async function projectIdentity(cwd: string): Promise<string>' },
    { kind: 'function', name: 'readJson', path: 'electron/main/services/private-json.ts', signature: 'export async function readJson(path: string): Promise<Record<string, unknown>>' },
    { kind: 'function', name: 'writePrivateJson', path: 'electron/main/services/private-json.ts', signature: 'export async function writePrivateJson(path: string, value: unknown): Promise<void>' },
    { kind: 'function', name: 'buildTomlTable', path: 'electron/main/services/toml.ts', signature: 'export function buildTomlTable(header: string, values: Record<string, string | string[]>): string' }
  ],
  R0b: [
    { kind: 'function', name: 'exportRemovedFeatures', path: 'electron/main/services/data-export/removed-features-export.ts', signature: 'export async function exportRemovedFeatures(deps: { db: AppDatabase; userData: string; workspaceRoots: () => string[]; previousDbVersion?: number; now?: () => number; force?: boolean }): Promise<{ path: string | null; created: boolean; error?: string }>' },
    { kind: 'function', name: 'removedFeaturesState', path: 'electron/main/services/data-export/removed-features-export.ts', signature: "export function removedFeaturesState(deps: { db: AppDatabase; userData: string; workspaceRoots: () => string[] }): { file: string | null; exportedAt: string | null; shownNotice: boolean; upgrade: boolean; error: string | null; removed: Array<{ id: 'codegraph' | 'semantic' | 'rtk' | 'memory' | 'linear' | 'teams' | 'automations' | 'docs' | 'oxepost' | 'oxepod' | 'work'; hadData: boolean; hadSettings: boolean }> }" },
    { kind: 'function', name: 'markRemovedFeaturesNoticeShown', path: 'electron/main/services/data-export/removed-features-export.ts', signature: 'export function markRemovedFeaturesNoticeShown(userData: string): void' },
    { kind: 'const', name: 'FIRST_1_5_0_DB_VERSION', path: 'electron/main/services/data-export/removed-features-export.ts', signature: 'export const FIRST_1_5_0_DB_VERSION = 92' }
  ],
  G4: [
    { kind: 'function', name: 'removeLegacyAgentHooks', path: 'electron/main/services/agent-hooks/legacy-cleanup.ts', signature: 'export async function removeLegacyAgentHooks(paths: { claudeSettings: string; codexHooks: string; memoryAdapters?: string }): Promise<{ changed: string[]; skipped: Array<{ path: string; reason: string }> }>' }
  ],
  'G1-be': [
    { kind: 'const', name: 'PANE_TYPES', path: 'shared/types/workspace.ts', signature: "export const PANE_TYPES: readonly PaneType[] = ['terminal', 'tasks', 'editor', 'review']" }
  ]
}
/** Exports removed that don't live in a deleted file. */
const REMOVED_EXTRA = {
  'R11-be': [{ name: 'parseFileSystemWriteFileInput', path: 'electron/main/ipc/validation.ts' }, { name: 'FileSystemWriteFileInput', path: 'shared/types/filesystem.ts' }, { name: 'FileSystemWriteFileResult', path: 'shared/types/filesystem.ts' }],
  R0a: [{ name: 'projectIdentity', path: 'electron/main/services/memory/memory-project.service.ts' }, { name: 'readJson', path: 'electron/main/services/memory/memory-runtime.ts' }, { name: 'writePrivateJson', path: 'electron/main/services/memory/memory-runtime.ts' }]
}
/** A kept export per task, when the preferred ones aren't among its edited files. */
const KEEP = {
  R0a: 'electron/main/services/memory/memory.service.ts', R0d: 'electron/main/services/delegation.service.ts', 'R11-be': 'electron/main/services/file-system.service.ts',
  'R15-be': 'electron/main/ipc/oxepod.ipc.ts', R4: 'electron/main/services/terminal.service.ts', G4: 'electron/main/services/terminal.service.ts',
  'G1-be': 'electron/main/services/workspace.service.ts#WorkspaceService', G6: 'electron/main/services/remote/topics.ts#createTopics', R3: 'electron/main/mcp-internal/tool-registry.ts#TOOL_REGISTRY'
}

function pack(task) {
  const item = ITEMS.find(entry => entry.id === task.id) ?? { gone: [], exists: {} }
  const deleted = (item.gone ?? []).slice().sort()
  const isDeleted = file => deleted.some(root => file === root || file === `${root}/` || file.startsWith(`${root.replace(/\/$/, '')}/`))
  const created = task.files.filter(file => !file.endsWith('/') && !existsSync(file) && !isDeleted(file)).sort()
  const edited = task.files.filter(file => !file.endsWith('/') && existsSync(file) && !isDeleted(file) && !statSync(file).isDirectory()).sort()
  // Moves (R0c): the new paths are created, with the old exports.
  const moved = item.id === 'R0c'
    ? deleted.flatMap(file => exportsOf(file).filter(entry => !['interface', 'type'].includes(entry.kind)).map(entry => ({ ...entry, path: entry.path.replace('services/documentation/', 'services/browser-preview/'), signature: entry.signature })))
    : []
  const keptFile = KEEP[task.id]
  let kept = []
  for (const preference of KEEP_PREFERENCE) {
    const [path, name] = preference.split('#')
    if (keptFile?.includes('#')) break
    if (edited.includes(path)) { kept = exportsOf(path).filter(entry => entry.name === name); if (kept.length) break }
  }
  const byKind = entries => ['class', 'function', 'const'].flatMap(kind => entries.filter(entry => entry.kind === kind))
  if (keptFile?.includes('#')) { const [path, name] = keptFile.split('#'); kept = exportsOf(path).filter(entry => entry.name === name) }
  else if (!kept.length && keptFile) kept = byKind(exportsOf(keptFile)).slice(0, 1)
  if (!kept.length) kept = edited.filter(file => file.startsWith('electron/main/') || file.startsWith('shared/')).flatMap(exportsOf).filter(entry => ['class', 'function', 'const'].includes(entry.kind)).slice(0, 1)
  const removed = deleted.flatMap(deletedFiles).flatMap(exportsOf).filter(entry => !['interface', 'type'].includes(entry.kind)).map(({ name, path }) => ({ name, path }))
  return {
    ...task,
    deleted_paths: deleted,
    edited_paths: edited,
    ...(created.length ? { created_paths: created } : {}),
    symbols: [...(NEW[task.id] ?? []), ...moved, ...kept],
    symbols_removed: [...removed, ...(REMOVED_EXTRA[task.id] ?? [])]
  }
}

for (const path of [removalsPath, gapsPath]) {
  const tasks = JSON.parse(readFileSync(path, 'utf8')).map(pack)
  writeFileSync(path, JSON.stringify(tasks, null, 2) + '\n')
  for (const task of tasks) {
    if (!task.symbols.length) throw new Error(`${task.id}: no symbol must exist after it`)
    console.log(`${task.id}: deleted ${task.deleted_paths.length}, edited ${task.edited_paths.length}, created ${task.created_paths?.length ?? 0}, symbols ${task.symbols.length} (${task.symbols.map(s => s.name).slice(0, 3).join(', ')}), removed ${task.symbols_removed.length}`)
  }
}
