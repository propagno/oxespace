/**
 * B7.4 · Policy files apply only in a version the person accepted.
 *
 * What is gated is a security projection of each file, never its text: a policy layer's rules in order (`policy.json`),
 * and the tool group modes of the project's `oxe.yaml`; `absent` and `invalid` are projections too, so deleting or
 * breaking a file is a change like any other. The accepted projection of each (subject, file) is kept in the database
 * (`accepted_project_config`, keyed like RepoHookTrust: `trustKey` of the repository folder). Readers get it through
 * `PolicyStore.load` and `effectiveToolConfig`; a file that differs is not applied until it is accepted:
 * - the app's own writes (Settings › Tools) record what they wrote, with an intent before the rename, so they apply directly;
 * - a change that only tightens applies at once (the syntactic rule in policy-change.ts), with a notice;
 * - a mixed policy change that splits exactly applies its stricter part at once and asks about the rest;
 * - anything else becomes a `policyChange` request in the approval center; the person's Deny marks that content rejected.
 *
 * This module is on the hot path (every `tools/call` reads the policy): a read costs a `stat` and map lookups. The
 * comparison, the classifier and the request are in policy-change.ts, loaded only when a file differs. There is no
 * watcher: a rule takes effect only when it is read, and every read checks.
 */
import { createHash, randomUUID } from 'node:crypto'
import { execFile, execFileSync } from 'node:child_process'
import { closeSync, openSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { AppDatabase } from '../../db'
import type { MainMessage } from '../../../../shared/messages'
import type { PolicyChangeFile, PolicyChangeStatus, PolicyLayer, PolicyRule } from '../../../../shared/policy'
import type { ApprovalRequest } from '../../../../shared/types/approvals'
import { CONFIGURABLE_MCP_TOOL_GROUPS, type ConfigurableMcpToolGroup, type McpToolGroupMode } from '../../../../shared/types/mcp-tools'
import type { ApprovalDraft, ApprovalOutcome } from '../approvals/approval-center'
import { recordIncident } from '../diagnostics/incident-sink'
import { canonicalPath, gitCommonDir } from '../git-common-dir'
import { MainRefusal } from '../main-refusal'
import { trustKey } from '../repo-config/trust'
import { parsePolicyProjection } from './projections'

/** `invalid` may say why (`tooLarge`, the parser's `problem`); neither is part of its hash. */
export type Projection<T> = { state: 'absent' } | { state: 'invalid'; tooLarge?: boolean; problem?: string } | { state: 'value'; value: T }
export type PolicyValue = { rules: PolicyRule[]; organization?: string }
export type ModesValue = Record<ConfigurableMcpToolGroup, { mode: McpToolGroupMode; source: 'default' | 'project' }>
export type PolicyProjection = Projection<PolicyValue>
export type ModesProjection = Projection<ModesValue>
export type AnyProjection = PolicyProjection | ModesProjection

export interface Subject {
  /** `<key>\0<file>`: one accepted version, one pending change and one open request at most per id. */
  id: string
  /** `project:<trustKey>`, `user` or `managed`. */
  key: string
  file: PolicyChangeFile
  layer: PolicyLayer
  root: string | null
  path: string
}

export type AcceptedVia = 'app-write' | 'person-confirmed' | 'narrowed' | 'baseline-default' | 'inherited'

interface Row { hash: string; json: string; intent: string | null; rejected: string | null; via: AcceptedVia }

/** What the classifier found (policy-change.ts). */
export interface ChangeVerdict { applies: boolean; widen: number; tighten: number }

/** How a change is shown: what already applies of it, and where its baseline came from. */
export interface ChangeContext {
  /** The accepted version before this change's stricter part applied (a partial change); else the base itself. */
  shownBase: AnyProjection
  /** Rule keys of the stricter part put in force at once (`policy-change.ts` `ruleKey`). */
  applied: string[]
  /** A mixed change that cannot be split exactly: nothing of it applies early. */
  notSplit: boolean
  /** The baseline is the primary checkout's accepted version (this worktree has none of its own). */
  inheritedFrom: string | null
  liveSessions: number
}

interface Pending {
  subject: Subject
  baseHash: string
  baseJson: string
  newHash: string
  newJson: string
  /** No accepted row and nothing inherited: the baseline is the app's defaults. */
  firstSight: boolean
  /** A worktree whose primary checkout cannot be resolved: the strict rule, with no first-sight leniency (review M4). */
  strict: boolean
  inheritedFrom: string | null
  rejected: boolean
  /** A request ended without the person (expired, cancelled, refused): asked again at the next review point only. */
  deferred: boolean
  /** "Review again": asked even when rejected or deferred. */
  forced: boolean
  verdict?: ChangeVerdict
  shownBaseJson?: string
  applied: string[]
  notSplit: boolean
  timer?: ReturnType<typeof setTimeout>
  checking?: Promise<void>
}

/** The one request per (subject, file); a newer change re-issues it rather than stacking another. */
interface OpenRequest { controller: AbortController; requestId?: string; baseHash: string; newHash: string; newJson: string }

export interface AcceptedConfigDeps {
  db: AppDatabase
  /** The approval center's `ask`; without it a change stays pending (the accepted rules apply). */
  ask?: (draft: ApprovalDraft, signal: AbortSignal, onAsked: (request: ApprovalRequest) => void) => Promise<ApprovalOutcome>
  /** The approval center's `reissue`: the same request, the next generation. */
  reissue?: (requestId: string, draft: ApprovalDraft) => ApprovalRequest | null
  /** Live agent executions whose folder is inside this root, for the request's note. */
  liveSessions?: (root: string) => number
  /** A notice for the window (the tightening that applied, the result of an answer). */
  notify?: (subject: Subject, message: MainMessage) => void
  /** Reads a gated file's text for the request (bounded); null when it is gone. */
  readText?: (path: string, max: number) => string | null
  /** Whether the managed file is out of the user's reach (only then it is not gated). A promise is awaited off the read path. */
  managedProtected?: (path: string) => boolean | Promise<boolean>
  /** Quiet period before a change is compared and asked (coalesces a file rewritten in a loop). */
  quietMs?: number
  /** At most one new request or re-issue per (subject, file) in this long. */
  reissueMs?: number
  now?: () => number
}

/** JSON with object keys sorted; arrays keep their order, which is semantic for rules. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * The hash of the power a projection grants: for a policy, its rules (resources compared without case, as they match),
 * not `organization`, which only names the policy; for oxe.yaml, each group's mode, not whether the file named it, so the
 * list form and the map form are the same projection. Why a file is invalid is not part of it.
 */
export function projectionHash(file: PolicyChangeFile, projection: AnyProjection): string {
  // Too large is its own projection (HML L): a Deny of an invalid file does not hide a too large one, and back.
  let power: unknown = projection.state === 'invalid' && projection.tooLarge ? { state: 'invalid', tooLarge: true } : { state: projection.state }
  if (projection.state === 'value' && file === 'policy') {
    power = { state: 'value', rules: (projection.value as PolicyValue).rules.map(rule => ({ ...rule, resource: rule.resource.toLowerCase() })) }
  } else if (projection.state === 'value') {
    power = { state: 'value', modes: Object.fromEntries(Object.entries(projection.value as ModesValue).map(([group, entry]) => [group, entry.mode])) }
  }
  return createHash('sha256').update(canonicalJson(power)).digest('hex')
}

export function defaultModes(): ModesValue {
  return Object.fromEntries(CONFIGURABLE_MCP_TOOL_GROUPS.map(group => [group, { mode: 'on-demand', source: 'default' }])) as ModesValue
}

/** The app's defaults, the baseline of a file never accepted: no policy rules; every group on demand. */
export function defaultProjection(file: PolicyChangeFile): AnyProjection {
  return file === 'policy' ? { state: 'absent' } : { state: 'value', value: defaultModes() }
}

const RANK: Record<McpToolGroupMode, number> = { off: 0, 'on-demand': 1, always: 2 }

/** A rule as policy-change.ts keys it (resources without case). */
const ruleKey = (rule: PolicyRule): string => `${rule.effect}\0${rule.action}\0${rule.resource.toLowerCase()}`

/**
 * What applies while a first-seen file is compared with the defaults (milliseconds, until policy-change.ts loads): never
 * more than either side. A policy keeps only its denies; each group takes the lower of its mode and on demand.
 */
function firstSightInterim(file: PolicyChangeFile, current: AnyProjection): AnyProjection {
  if (file === 'policy') {
    if (current.state !== 'value') return { state: 'absent' }
    const value = current.value as PolicyValue
    return { state: 'value', value: { ...value, rules: value.rules.filter(rule => rule.effect === 'deny') } }
  }
  const modes = defaultModes()
  if (current.state === 'value') {
    for (const group of CONFIGURABLE_MCP_TOOL_GROUPS) {
      const entry = (current.value as ModesValue)[group]
      if (entry && RANK[entry.mode] < RANK[modes[group].mode]) modes[group] = entry
    }
  }
  return { state: 'value', value: modes }
}

/** The file as the request and notices name it, relative to the project. */
export const fileLabel = (subject: Pick<Subject, 'file' | 'layer' | 'path'>): string =>
  subject.file === 'oxe.yaml' ? 'oxe.yaml' : subject.layer === 'project' ? '.oxespace/policy.json' : basename(subject.path)

/** Owners a managed policy may have on Windows: SYSTEM, Administrators, TrustedInstaller (SIDs, so any display language works). */
const TRUSTED_OWNER_SIDS = new Set(['S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'])

/** Windows PowerShell by its full path: never one found on PATH or in the project. */
const powershell = (): string => join(process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

/**
 * Reads the owner SIDs of the paths in OXESPACE_ACL_PATHS (file|folder) through .NET, not Get-Acl, which would load a
 * module from the user's own module path. The paths are never part of the command text (review N1).
 */
export const OWNER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$p = $env:OXESPACE_ACL_PATHS.Split('|')",
  '$t = [System.Security.Principal.SecurityIdentifier]',
  '[System.IO.File]::GetAccessControl($p[0]).GetOwner($t).Value',
  '[System.IO.Directory]::GetAccessControl($p[1]).GetOwner($t).Value'
].join('; ')

export type RunFile = (file: string, args: string[], options: { env: NodeJS.ProcessEnv; timeout: number; windowsHide: boolean }) => Promise<{ stdout: string }>

/** The owner SIDs of the managed file and its folder on Windows, in one process; null where they cannot be read. */
export async function windowsOwnerSids(file: string, folder: string, run: RunFile = promisify(execFile) as unknown as RunFile): Promise<[string | null, string | null]> {
  // `|` separates the two paths; Windows paths cannot hold it, so one that does is not read at all.
  if (file.includes('|') || folder.includes('|')) return [null, null]
  try {
    const { stdout } = await run(powershell(), ['-NoProfile', '-NonInteractive', '-Command', OWNER_SCRIPT],
      { env: { ...process.env, OXESPACE_ACL_PATHS: `${file}|${folder}` }, timeout: 5_000, windowsHide: true })
    const [owner, folderOwner] = String(stdout).split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    return [owner ?? null, folderOwner ?? null]
  } catch {
    return [null, null]
  }
}

/** What the managed probe reads; tests pass stand-ins. */
export interface ManagedProbeIo {
  /** Whether this user can open the file to write, or create a file beside it. */
  writable(path: string): boolean
  owners(file: string, folder: string): Promise<[string | null, string | null]>
}

const denied = (error: unknown) => ['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException)?.code ?? '')

/** Opening the file `r+` or creating a probe file (`wx`, removed at once) in its folder; any doubt counts as writable. */
function probeWritable(path: string): boolean {
  try { closeSync(openSync(path, 'r+')); return true } catch (error) { if (!denied(error)) return true }
  const probe = join(dirname(path), `.oxespace-probe-${randomUUID()}`)
  try {
    closeSync(openSync(probe, 'wx'))
    try { unlinkSync(probe) } catch { /* left behind: an empty file of ours */ }
    return true
  } catch (error) { return !denied(error) }
}

/**
 * Whether the managed policy file is out of the user's reach, so an agent running as the user cannot have written it.
 * Linux/macOS: file and folder owned by root with no group or other write bit. Windows: this user cannot write the file
 * or create one in its folder, AND both are owned by SYSTEM, Administrators or TrustedInstaller (a folder a user created
 * is theirs, and its owner can take write back, review M3). Anything else, or any doubt, is not protected.
 */
export async function managedIsProtected(path: string, platform: NodeJS.Platform = process.platform, io: ManagedProbeIo = { writable: probeWritable, owners: windowsOwnerSids }): Promise<boolean> {
  try {
    if (platform !== 'win32') {
      const file = statSync(path)
      const folder = statSync(dirname(path))
      return file.uid === 0 && folder.uid === 0 && (file.mode & 0o022) === 0 && (folder.mode & 0o022) === 0
    }
    if (io.writable(path)) return false
    const owners = await io.owners(path, dirname(path))
    return owners.every(owner => TRUSTED_OWNER_SIDS.has(owner ?? ''))
  } catch {
    return false
  }
}

/**
 * Whether a linked worktree is the one its repository knows (review N3): its .git file names a folder under
 * `<common>/worktrees/`, and that folder's `gitdir` names this worktree's .git back. Both are the user's files, so this is
 * defense in depth; anything else is an unknown primary (the strict rule).
 */
function backLinked(root: string, common: string): boolean {
  try {
    const dotGit = join(root, '.git')
    const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))
    if (!match) return false
    const gitDir = resolve(root, match[1].trim())
    if (canonicalPath(dirname(gitDir)) !== canonicalPath(join(common, 'worktrees'))) return false
    return canonicalPath(resolve(gitDir, readFileSync(join(gitDir, 'gitdir'), 'utf8').trim())) === canonicalPath(dotGit)
  } catch {
    return false
  }
}

export class AcceptedConfig {
  /** Moves whenever an accepted version changes, so readers' caches are dropped. */
  version = 0
  private rows: Map<string, Row> | null = null
  private readonly staleIntents = new Set<string>()
  private readonly pending = new Map<string, Pending>()
  private readonly open = new Map<string, OpenRequest>()
  private readonly keys = new Map<string, string>()
  private readonly primaries = new Map<string, { key: string; root: string } | 'unknown' | null>()
  private readonly running = new Set<Promise<unknown>>()
  /** When each (subject, file) was last asked or re-issued. */
  private readonly lastAsked = new Map<string, number>()
  /** HEAD's committed denies per subject, read once per run (first sight only). */
  private readonly committedDenies = new Map<string, PolicyRule[]>()
  /** The managed probe's answer per stat key of the managed file, or the check still running. */
  private readonly managedProbes = new Map<string, boolean | Promise<boolean>>()

  constructor(private readonly deps: AcceptedConfigDeps) {}

  /** Wires the approval center and the window after start-up (registerPolicyIpc). */
  connect(next: Pick<AcceptedConfigDeps, 'ask' | 'reissue' | 'liveSessions' | 'notify' | 'readText'>): void { Object.assign(this.deps, next) }

  subject(file: PolicyChangeFile, layer: PolicyLayer, root: string | null, path: string): Subject {
    const key = layer === 'project' && root ? this.projectKey(root) : layer
    return { id: `${key}\0${file}`, key, file, layer, root: layer === 'project' ? root : null, path }
  }

  /**
   * Whether the managed file (at this stat key) is out of the user's reach. The check runs off the main thread, once per
   * change of the file, and the layer is gated until it answers (review N2); a protected answer then ungates it.
   */
  managedProtected(path: string, key = ''): boolean {
    const id = `${path}\0${key}`
    const known = this.managedProbes.get(id)
    if (typeof known === 'boolean') return known
    if (known) return false
    for (const other of [...this.managedProbes.keys()]) if (other.startsWith(`${path}\0`)) this.managedProbes.delete(other)
    const probe = (this.deps.managedProtected ?? (item => managedIsProtected(item)))(path)
    if (typeof probe === 'boolean') { this.managedProbes.set(id, probe); return probe }
    this.managedProbes.set(id, probe)
    void probe.then(result => {
      if (this.managedProbes.get(id) !== probe) return
      this.managedProbes.set(id, result)
      if (result) { this.drop('managed\0policy'); this.version++ }
    }, () => { if (this.managedProbes.get(id) === probe) this.managedProbes.set(id, false) })
    return false
  }

  /** A managed check still running: its layer's request waits for it, so an admin-owned file is not asked about. */
  private managedChecking(): boolean {
    return [...this.managedProbes.values()].some(value => typeof value !== 'boolean')
  }

  /**
   * The projection that applies for what is on disk now: the current one when it is the accepted version (or the app's
   * own write landing), else the accepted one, while the change is compared and, if it widens, asked.
   */
  resolve<T extends AnyProjection>(subject: Subject, current: T): T {
    const hash = projectionHash(subject.file, current)
    let row = this.row(subject.id)
    if (row?.intent) {
      if (row.intent === hash) this.store(subject.id, { ...row, hash, json: JSON.stringify(current), intent: null, rejected: null, via: 'app-write' })
      else if (this.staleIntents.has(subject.id)) this.store(subject.id, { ...row, intent: null })
      this.staleIntents.delete(subject.id)
      row = this.row(subject.id)
    }
    let base = this.baseline(subject, row)
    // First sight: the part of the file that only narrows the defaults (its denies; each group at most on demand) is
    // the accepted version at once, synchronously, so a change written right after it can never drop it (HML H, review
    // H1). Only the rest, if any, is compared and asked.
    let firstSeen: { shownBaseJson: string; applied: string[]; strict: boolean } | null = null
    if (!row && base.firstSight) {
      const part = this.withCommittedDenies(subject, firstSightInterim(subject.file, current))
      const partHash = projectionHash(subject.file, part)
      if (partHash !== base.hash) {
        firstSeen = { shownBaseJson: base.json, strict: base.strict, applied: part.state === 'value' && subject.file === 'policy' ? (part.value as PolicyValue).rules.map(ruleKey) : [] }
        this.store(subject.id, { hash: partHash, json: JSON.stringify(part), intent: null, rejected: null, via: 'baseline-default' })
        row = this.row(subject.id)
        base = this.baseline(subject, row)
      }
    }
    // A worktree keeps its primary's version as its own from the first read, so editing or deleting its .git file
    // later cannot reset it to the defaults or point it at another project (review M4).
    if (!row && base.inheritedFrom) {
      this.store(subject.id, { hash: base.hash, json: base.json, intent: null, rejected: null, via: 'inherited' })
      row = this.row(subject.id)
    }
    if (hash === base.hash) { this.drop(subject.id); return current }
    let entry = this.pending.get(subject.id)
    if (!entry || entry.newHash !== hash || entry.baseHash !== base.hash) {
      if (entry?.timer) clearTimeout(entry.timer)
      // A rewrite while a request waits keeps that request open: the next check re-issues it with the new content.
      entry = { subject, baseHash: base.hash, baseJson: base.json, newHash: hash, newJson: JSON.stringify(current), firstSight: base.firstSight || firstSeen !== null, strict: firstSeen?.strict ?? base.strict,
        inheritedFrom: base.inheritedFrom, rejected: row?.rejected === hash, deferred: false, forced: false, applied: firstSeen?.applied ?? [], notSplit: false,
        ...(firstSeen ? { shownBaseJson: firstSeen.shownBaseJson } : {}) }
      this.pending.set(subject.id, entry)
      if (!entry.rejected) this.schedule(entry)
      else this.closeOpen(subject.id)
    }
    return (base.firstSight ? firstSightInterim(subject.file, current) : base.projection) as T
  }

  /**
   * The denies of the version committed at git HEAD, added to a first-seen policy's denies (HML: a file rewritten before
   * the first read must not drop the committed denies). Only denies: the list stays stricter than both. Read once per
   * subject and run, with git (argv, no shell); none without a repository, a HEAD, or the file in it.
   */
  private withCommittedDenies(subject: Subject, part: AnyProjection): AnyProjection {
    if (subject.file !== 'policy' || subject.layer !== 'project' || !subject.root) return part
    let denies = this.committedDenies.get(subject.id)
    if (!denies) {
      denies = []
      try {
        const path = relative(subject.root, subject.path).split(sep).join('/')
        const text = execFileSync('git', ['-C', subject.root, 'show', `HEAD:${path}`], { encoding: 'utf8', timeout: 3_000, maxBuffer: 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
        const committed = parsePolicyProjection(text, 'project', subject.path).projection
        if (committed.state === 'value') denies = committed.value.rules.filter(rule => rule.effect === 'deny')
      } catch { /* no repository, no HEAD, or not committed */ }
      this.committedDenies.set(subject.id, denies)
    }
    if (!denies.length) return part
    const own = part.state === 'value' ? (part.value as PolicyValue) : { rules: [] as PolicyRule[] }
    const seen = new Set(own.rules.map(ruleKey))
    return { state: 'value', value: { ...own, rules: [...own.rules, ...denies.filter(rule => !seen.has(ruleKey(rule)))] } }
  }

  /** The changes of these subjects that are not accepted, for Settings. */
  status(subjects: Subject[]): PolicyChangeStatus[] {
    const result: PolicyChangeStatus[] = []
    for (const subject of subjects) {
      const entry = this.pending.get(subject.id)
      if (!entry) continue
      result.push({ layer: subject.layer, file: subject.file, path: entry.subject.path, state: entry.rejected ? 'rejected' : 'pending',
        baseHash: entry.baseHash, newHash: entry.newHash, ...(entry.verdict ? { widen: entry.verdict.widen, tighten: entry.verdict.tighten } : {}) })
    }
    return result
  }

  /** A launch or a Settings read for these subjects: a change whose request ended unanswered is asked again (once). */
  reviewPoint(subjects: Subject[]): void {
    for (const subject of subjects) {
      const entry = this.pending.get(subject.id)
      if (entry?.deferred && !entry.rejected && !this.open.has(subject.id)) { entry.deferred = false; this.schedule(entry) }
    }
  }

  /** "Review again" from Settings: asks about this exact change even if the person kept it out before. */
  review(subject: Subject, baseHash: string, newHash: string): void {
    const entry = this.pending.get(subject.id)
    if (!entry || entry.baseHash !== baseHash || entry.newHash !== newHash) throw new MainRefusal('policy.change.notPending', {})
    entry.forced = true
    entry.deferred = false
    if (!this.open.has(subject.id)) this.schedule(entry, 0)
  }

  /**
   * Accept, from Settings: records the compared content as accepted, only while the accepted version is still the one
   * it was compared with (a compare-and-set in the database). Never re-reads the file. An open request for it closes.
   */
  accept(subject: Subject, baseHash: string, newHash: string): void {
    const entry = this.pending.get(subject.id)
    if (!entry || entry.newHash !== newHash || entry.baseHash !== baseHash) throw new MainRefusal('policy.change.notPending', {})
    const next = JSON.parse(entry.newJson) as AnyProjection
    // An invalid or too large file is Deny only (DESIGN #359): it cannot be accepted as it is.
    if (next.state === 'invalid') throw new MainRefusal('policy.change.notApplicable', {})
    if (!this.compareAndSet(subject, baseHash, newHash, entry.newJson, 'person-confirmed')) {
      this.drop(subject.id)
      this.version++
      throw new MainRefusal('policy.change.baseChanged', {})
    }
  }

  /**
   * For an app writer about to change a gated file (Settings › Tools): refuses with `policy.change.pending` unless what
   * it read is the accepted version, and no other gated file of the project waits for an answer, so a pending change is
   * never written through (and recorded as the person's) by an unrelated click.
   */
  async assertAccepted(subject: Subject, read: AnyProjection): Promise<void> {
    this.resolve(subject, read)
    // Every change of this project that would block the write is compared now and, if it waits, asked (or asked again),
    // so a refusal always has a request to answer (HML M-1).
    for (const entry of [...this.pending.values()].filter(item => item.subject.key === subject.key)) {
      if (entry.subject.id !== subject.id && entry.rejected) continue
      if (entry.rejected || entry.deferred) { entry.forced = true; entry.deferred = false }
      if (entry.timer) { clearTimeout(entry.timer); entry.timer = undefined }
      this.check(entry)
      await entry.checking
    }
    if (projectionHash(subject.file, read) !== this.baseline(subject, this.row(subject.id)).hash) throw new MainRefusal('policy.change.pending', {})
    for (const other of this.pending.values()) {
      if (other.subject.key === subject.key && other.subject.id !== subject.id && !other.rejected) throw new MainRefusal('policy.change.pending', {})
    }
  }

  /** Before the rename of an app write: what is about to land is recorded, so a read in between promotes it silently. */
  markIntent(subject: Subject, next: AnyProjection): string {
    const hash = projectionHash(subject.file, next)
    const row = this.row(subject.id) ?? this.baselineRow(subject)
    this.store(subject.id, { ...row, intent: hash })
    return hash
  }

  /** After the rename: the written content is the accepted version (unless a read promoted it already). */
  commitIntent(subject: Subject, hash: string, next: AnyProjection): void {
    const row = this.row(subject.id)
    if (row?.intent === hash) this.store(subject.id, { ...row, hash, json: JSON.stringify(next), intent: null, rejected: null, via: 'app-write' })
    this.drop(subject.id)
  }

  /** The write did not land: the intent goes. */
  clearIntent(subject: Subject, hash: string): void {
    const row = this.row(subject.id)
    if (row?.intent === hash) this.store(subject.id, { ...row, intent: null })
  }

  /** The project is removed: its open requests end (only this, or a replacement, cancels them; closing a pane does not). */
  forgetRoot(root: string): void {
    const key = this.projectKey(root)
    for (const [id, entry] of [...this.pending]) if (entry.subject.key === key) this.drop(id)
  }

  /** Tests: resolves when no comparison or request start is running. */
  async idle(): Promise<void> {
    for (let round = 0; round < 200; round++) {
      const timers = [...this.pending.values()].some(entry => entry.timer)
      if (!this.running.size && !timers) return
      await Promise.race([...this.running, new Promise(resolve => setTimeout(resolve, 5))])
    }
  }

  // ---- internals ------------------------------------------------------------------------------

  private projectKey(root: string): string {
    let key = this.keys.get(root)
    if (!key) {
      key = `project:${trustKey(canonicalPath(root))}`
      this.keys.set(root, key)
    }
    return key
  }

  /** A linked worktree's primary checkout (git's common dir), whose accepted version a worktree starts from. */
  private primary(subject: Subject): { key: string; root: string } | 'unknown' | null {
    if (!subject.root) return null
    if (!this.primaries.has(subject.key)) {
      const common = gitCommonDir(subject.root)
      const root = common && basename(common) === '.git' ? dirname(common) : null
      const key = root ? this.projectKey(root) : null
      let found: { key: string; root: string } | 'unknown' | null = root && key && key !== subject.key ? (backLinked(subject.root, common!) ? { key, root } : 'unknown') : null
      // A .git file is a linked worktree; one that does not resolve to a repository is not a fresh project.
      if (!found && !common) { try { if (statSync(join(subject.root, '.git')).isFile()) found = 'unknown' } catch { /* no .git: not a worktree */ } }
      this.primaries.set(subject.key, found)
    }
    return this.primaries.get(subject.key) ?? null
  }

  private baseline(subject: Subject, row: Row | undefined): { hash: string; json: string; projection: AnyProjection; firstSight: boolean; strict: boolean; inheritedFrom: string | null } {
    if (row) {
      const primary = row.via === 'inherited' ? this.primary(subject) : null
      return { hash: row.hash, json: row.json, projection: JSON.parse(row.json) as AnyProjection, firstSight: false, strict: false, inheritedFrom: primary && primary !== 'unknown' ? primary.root : null }
    }
    const primary = this.primary(subject)
    const known = primary && primary !== 'unknown' ? primary : null
    const inherited = known ? this.row(`${known.key}\0${subject.file}`) : undefined
    if (inherited && known) return { hash: inherited.hash, json: inherited.json, projection: JSON.parse(inherited.json) as AnyProjection, firstSight: false, strict: false, inheritedFrom: known.root }
    const projection = defaultProjection(subject.file)
    return { hash: projectionHash(subject.file, projection), json: JSON.stringify(projection), projection, firstSight: true, strict: primary === 'unknown', inheritedFrom: null }
  }

  private baselineRow(subject: Subject): Row {
    const base = this.baseline(subject, undefined)
    return { hash: base.hash, json: base.json, intent: null, rejected: null, via: 'baseline-default' }
  }

  private loadRows(): Map<string, Row> {
    if (this.rows) return this.rows
    const rows = new Map<string, Row>()
    const found = this.deps.db.prepare('SELECT subject, file, projection_hash, projection_json, intent_hash, rejected_hash, accepted_via FROM accepted_project_config').all() as
      Array<{ subject: string; file: string; projection_hash: string; projection_json: string; intent_hash: string | null; rejected_hash: string | null; accepted_via: AcceptedVia }>
    for (const row of found) {
      const id = `${row.subject}\0${row.file}`
      rows.set(id, { hash: row.projection_hash, json: row.projection_json, intent: row.intent_hash, rejected: row.rejected_hash, via: row.accepted_via })
      // An intent from an earlier run: promoted if the file is what it meant, else cleared, at its first read.
      if (row.intent_hash) this.staleIntents.add(id)
    }
    this.rows = rows
    return rows
  }

  private row(id: string): Row | undefined { return this.loadRows().get(id) }

  private store(id: string, row: Row): void {
    const [subject, file] = id.split('\0')
    this.deps.db.prepare(`INSERT INTO accepted_project_config (subject, file, projection_hash, projection_json, intent_hash, rejected_hash, accepted_via, accepted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(subject, file) DO UPDATE SET projection_hash = excluded.projection_hash, projection_json = excluded.projection_json,
      intent_hash = excluded.intent_hash, rejected_hash = excluded.rejected_hash, accepted_via = excluded.accepted_via, accepted_at = excluded.accepted_at`)
      .run(subject, file, row.hash, row.json, row.intent, row.rejected, row.via, this.now())
    this.loadRows().set(id, row)
    this.version++
  }

  /** Records `newJson` as accepted only if the accepted version is still `baseHash`. `keep` leaves the pending entry (a partial change). */
  private compareAndSet(subject: Subject, baseHash: string, newHash: string, newJson: string, via: AcceptedVia, keep = false): boolean {
    const row = this.row(subject.id)
    const [key, file] = subject.id.split('\0')
    let changes: number
    if (row) {
      changes = this.deps.db.prepare(`UPDATE accepted_project_config SET projection_hash = ?, projection_json = ?, rejected_hash = NULL, intent_hash = NULL, accepted_via = ?, accepted_at = ?
        WHERE subject = ? AND file = ? AND projection_hash = ?`).run(newHash, newJson, via, this.now(), key, file, baseHash).changes
    } else {
      if (this.baseline(subject, undefined).hash !== baseHash) return false
      changes = this.deps.db.prepare(`INSERT INTO accepted_project_config (subject, file, projection_hash, projection_json, intent_hash, rejected_hash, accepted_via, accepted_at)
        VALUES (?, ?, ?, ?, NULL, NULL, ?, ?) ON CONFLICT(subject, file) DO NOTHING`).run(key, file, newHash, newJson, via, this.now()).changes
    }
    if (changes !== 1) { this.rows = null; return false }
    this.loadRows().set(subject.id, { hash: newHash, json: newJson, intent: null, rejected: null, via })
    this.version++
    if (!keep) this.drop(subject.id)
    return true
  }

  private reject(entry: Pending): boolean {
    const row = this.row(entry.subject.id) ?? this.baselineRow(entry.subject)
    if (row.hash !== entry.baseHash) return false
    this.store(entry.subject.id, { ...row, rejected: entry.newHash })
    entry.rejected = true
    entry.forced = false
    return true
  }

  private closeOpen(id: string): void {
    this.open.get(id)?.controller.abort()
    this.open.delete(id)
  }

  private drop(id: string): void {
    const entry = this.pending.get(id)
    if (entry?.timer) clearTimeout(entry.timer)
    this.pending.delete(id)
    this.closeOpen(id)
  }

  private now(): number { return this.deps.now?.() ?? Date.now() }

  private track(promise: Promise<unknown>): void {
    this.running.add(promise)
    void promise.finally(() => this.running.delete(promise))
  }

  private schedule(entry: Pending, delay = this.deps.quietMs ?? 500): void {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => { entry.timer = undefined; this.check(entry) }, delay)
    entry.timer.unref?.()
  }

  private check(entry: Pending): void {
    const run = (async () => {
      if (this.pending.get(entry.subject.id) !== entry) return
      const change = await import('./policy-change')
      if (this.pending.get(entry.subject.id) !== entry) return
      const base = JSON.parse(entry.baseJson) as AnyProjection
      const next = JSON.parse(entry.newJson) as AnyProjection
      if (!entry.verdict) {
        entry.verdict = change.classify(entry.subject, base, next)
        if (entry.verdict.applies) {
          const pure = entry.verdict.tighten > 0 && !entry.firstSight
          if (this.compareAndSet(entry.subject, entry.baseHash, entry.newHash, entry.newJson, entry.firstSight ? 'baseline-default' : 'narrowed') && pure) {
            this.deps.notify?.(entry.subject, { code: 'policy.narrowed', params: { file: fileLabel(entry.subject) } })
          }
          return
        }
        // A mixed policy change: its pure narrowing applies now, when it splits exactly; the rest is asked against that.
        // One with a moved or edited rule cannot be split: nothing of it applies early, and the request says so.
        // At first sight too: the denies a first-seen file holds are in force while it is asked, so they are stored as
        // the accepted version before asking, and Deny keeps them (review H1).
        if (entry.subject.file === 'policy' && next.state === 'value') {
          const split = change.narrowingPart(base, next)
          if (!split) entry.notSplit = true
          else if (split.applied.length && entry.verdict.tighten > 0) {
            const json = JSON.stringify(split.projection)
            const hash = projectionHash('policy', split.projection)
            if (this.compareAndSet(entry.subject, entry.baseHash, hash, json, 'narrowed', true)) {
              entry.shownBaseJson = entry.baseJson
              entry.baseHash = hash
              entry.baseJson = json
              entry.applied = split.applied
            }
          }
        }
      }
      await this.raise(entry, change)
    })().catch(() => undefined)
    entry.checking = run
    this.track(run)
  }

  private context(entry: Pending): ChangeContext {
    return {
      shownBase: JSON.parse(entry.shownBaseJson ?? entry.baseJson) as AnyProjection, applied: entry.applied, notSplit: entry.notSplit,
      inheritedFrom: entry.inheritedFrom, liveSessions: entry.subject.root ? this.deps.liveSessions?.(entry.subject.root) ?? 0 : 0
    }
  }

  private async raise(entry: Pending, change: typeof import('./policy-change')): Promise<void> {
    const id = entry.subject.id
    const open = this.open.get(id)
    if (!this.deps.ask || (open && open.newHash === entry.newHash && open.baseHash === entry.baseHash)) return
    if ((entry.rejected || entry.deferred) && !entry.forced) return
    const wait = (this.lastAsked.get(id) ?? -Infinity) + (this.deps.reissueMs ?? 3_000) - this.now()
    if (wait > 0 && !entry.forced) { this.schedule(entry, wait); return }
    if (entry.subject.layer === 'managed' && this.managedChecking()) { this.schedule(entry); return }
    this.lastAsked.set(id, this.now())
    const next = JSON.parse(entry.newJson) as AnyProjection
    // Read once: the text shown must be the version an Allow records, or the request waits for the next read (review M2).
    const shown = change.readShown(entry.subject, next, this.deps.readText)
    if (shown === null) {
      this.pending.delete(id)
      this.version++
      return
    }
    const text = shown
    const draft = await change.requestDraft(entry.subject, JSON.parse(entry.baseJson) as AnyProjection, next, text, this.context(entry))
    if (this.pending.get(id) !== entry) return
    // A rewrite while the request waits: the same request, the next generation (DESIGN #359: requests never stack).
    const current = this.open.get(id)
    if (current?.requestId && this.deps.reissue?.(current.requestId, draft)) {
      Object.assign(current, { baseHash: entry.baseHash, newHash: entry.newHash, newJson: entry.newJson })
      return
    }
    this.closeOpen(id)
    const request: OpenRequest = { controller: new AbortController(), baseHash: entry.baseHash, newHash: entry.newHash, newJson: entry.newJson }
    this.open.set(id, request)
    recordIncident('incident.policy.changedOutside', entry.subject.key)
    // The check ends once the request is out; the answer is handled when it comes, so a writer never waits for the person.
    void this.deps.ask(draft, request.controller.signal, asked => { request.requestId = asked.id }).then(outcome => this.answered(entry, request, outcome), () => undefined)
  }

  private answered(entry: Pending, request: OpenRequest, outcome: ApprovalOutcome): void {
    const id = entry.subject.id
    if (this.open.get(id) !== request) return
    this.open.delete(id)
    const answered = this.pending.get(id)
    if (outcome.intent === 'allow') {
      // Bound to the versions the last generation showed; never to the file as it is now.
      if (this.compareAndSet(entry.subject, request.baseHash, request.newHash, request.newJson, 'person-confirmed')) {
        this.deps.notify?.(entry.subject, { code: 'policy.result.applied', params: {} })
      } else if (answered) { this.drop(id); this.version++ }
      return
    }
    if (!answered || answered.newHash !== request.newHash || answered.baseHash !== request.baseHash) return
    if (outcome.by === 'user' || outcome.by === 'native') {
      // Only the person's own Deny marks this content rejected; an expiry or a refusal asks again later.
      if (this.reject(answered)) this.deps.notify?.(entry.subject, { code: 'policy.result.kept', params: {} })
    } else {
      answered.deferred = true
      answered.forced = false
    }
  }
}
