import { basename, dirname, isAbsolute } from 'node:path'
import type { AppDatabase } from '../../db'
import type { ConversationThread, ThreadEvent, ThreadSnapshot } from '../../../../shared/types/thread'
import { THREAD_PLACE_DRIFT_ANSWERS, type ThreadCollision, type ThreadPane, type ThreadPaneSource, type ThreadPathResolution, type ThreadPlace, type ThreadPlaceDiff, type ThreadPlaceDrift, type ThreadPlaceDriftAnswer, type ThreadPlaceHead, type ThreadPlaceReadResult, type ThreadPlaces, type ThreadPlaceWrite } from '../../../../shared/types/thread-places'
import { mainMessage, messageFromError, type MainMessage } from '../../../../shared/messages'
import { MainMessageError } from '../../ipc/main-message-error'
import { canonicalPath, resolveSessionLocation } from '../git-common-dir'
import { PersonActionAudit } from '../person-action-audit'
import type { ThreadHistoryWriteOptions } from './thread-history'
import { placeEvidenceOf, type PlaceTurn, type ThreadPlaceStore } from './thread-places'
import { threadPanes } from './thread-panes'
import { headFollows, operationInProgress, readPlaceDrift, sameHead, switchPlaceBack } from './thread-place-drift'
import { readPlaceFile as readPlaceFileFrom } from './thread-place-read'
import { placeDiff as placeDiffOf } from './thread-place-diff'
import { parseThreadPathInput, resolveThreadPath, type ThreadPathPlace } from './thread-path-resolver'
import { threadCollisions } from './thread-collisions'
import { readThreadTitle } from './thread-title'

/** HML 704-1: tools that run shell commands; a HEAD move while one runs is the conversation's own, whatever the command. */
const SHELL_TOOL = /bash|shell|command|exec|terminal|powershell/i

// Canonical comparison: a Windows short name and its long form are the same folder.
const sameCheckout = (a: string, b: string): boolean => canonicalPath(a) === canonicalPath(b)

/** What the place code needs from the orchestrator; never the orchestrator itself. */
export interface ThreadPlaceObserverDeps {
  db: AppDatabase
  placeStore: ThreadPlaceStore
  readThread(id: string): ConversationThread
  read(id: string): ThreadSnapshot
  save(snapshot: ThreadSnapshot, options: ThreadHistoryWriteOptions): void
  paneSources(): ThreadPaneSource[]
  /** A turn of this conversation runs (the orchestrator's busy set). */
  isBusy(id: string): boolean
  /** A send is starting a turn and has not reserved the conversation as busy yet. */
  isStarting(id: string): boolean
  /** Opens a checkpoint and baseline for a checkout a running turn moved into (the orchestrator's turn tracker). */
  beginCheckpoint(id: string, turnId: string, root: string, label: string): Promise<unknown>
}

/**
 * F4 places of the conversations (CR-F4-3, moved out of ThreadOrchestrator with no behaviour change): places with
 * their drift (A15), place diff (A14), place read (A17), path resolution and the per-turn cwd (A16), panes (A18) and
 * collisions (A54). The orchestrator owns one instance and delegates each public method to it.
 */
export class ThreadPlaceObserver {
  /** A16: a cwd the provider reported while no turn ran; it goes to the next turn's thread_turn_cwd row. */
  private readonly pendingTurnCwd = new Map<string, { afterTurnId: string | null; cwd: string }>()
  /** A15: drift reads, own HEAD moves and their bookkeeping run one at a time per conversation. */
  private readonly driftQueues = new Map<string, Promise<void>>()
  /** A15: the HEAD each place showed at the last read, per conversation. */
  private readonly lastHeads = new Map<string, Map<string, ThreadPlaceHead>>()
  /** HML 704-1: running shell tools per conversation, each with the heads seen before it started. */
  private readonly shellTools = new Map<string, Map<string, Map<string, ThreadPlaceHead>>>()
  /** HML 704-1: a HEAD the conversation moved a place to itself; drift is measured from there. */
  private readonly acceptedHeads = new Map<string, Map<string, ThreadPlaceHead>>()
  /** SECURITY S5: the append-only trail of what the person did from the window. */
  private personAuditLog?: PersonActionAudit

  constructor(private readonly deps: ThreadPlaceObserverDeps) {}

  private audit(): PersonActionAudit { return (this.personAuditLog ??= new PersonActionAudit(this.deps.db)) }

  /** Where this conversation worked: its root, then each worktree, checkout and outside folder the evidence named. */
  async places(id: string): Promise<ThreadPlaces> {
    const result = await this.deps.placeStore.list(this.deps.readThread(id))
    const places = (await this.inDriftQueue(id, () => this.observePlaces(id))).places
    return { ...result, places }
  }

  /**
   * A15 (thread:place-drift-answer): Switch back (git switch to the base branch, guarded), Follow (base := drift.to) or
   * Dismiss (keep the base). SECURITY S5: every Switch back attempt writes one person_action_audit row.
   */
  async answerPlaceDrift(id: string, placeId: string, answer: ThreadPlaceDriftAnswer): Promise<{ ok: true; place: ThreadPlace } | { ok: false; refusal: MainMessage }> {
    if (!(THREAD_PLACE_DRIFT_ANSWERS as readonly string[]).includes(answer)) throw new Error('This is not an answer to a branch change.')
    const switching = answer === 'switched-back'
    const { places } = await this.places(id)
    const place = places.find(entry => entry.id === placeId)
    const audit = (outcome: 'ok' | 'refused' | 'error', code?: string): void => {
      if (!switching) return
      this.audit().record({ action: 'place-switch-back', threadId: id, placeId: String(placeId), target: place?.base?.branch ?? '', outcome, ...(code ? { code } : {}) })
    }
    const refuse = (refusal: MainMessage): { ok: false; refusal: MainMessage } => { audit('refused', refusal.code); return { ok: false, refusal } }
    if (!place) return refuse(mainMessage('thread.place.gone', {}))
    const drift = place.drift
    if (!drift || drift.answer || place.kind === 'outside' || !place.base) return refuse(mainMessage('thread.place.noDrift', {}))
    if (switching) {
      // HML 704-3: never under a running turn of this conversation.
      if (this.deps.isBusy(id) || this.deps.isStarting(id)) return refuse(mainMessage('thread.place.busy', {}))
      let result: Awaited<ReturnType<typeof switchPlaceBack>>
      try { result = await switchPlaceBack(place) } catch (error) { audit('error'); throw error }
      if (!result.ok) return refuse(result.refusal)
      audit('ok')
    }
    const answered: ThreadPlaceDrift = { ...drift, answer }
    if (answer === 'followed') {
      this.deps.db.prepare('UPDATE thread_places SET base_commit = ?, base_branch = ?, drift_json = ? WHERE thread_id = ? AND id = ?')
        .run(drift.to.commit, drift.to.branch, JSON.stringify(answered), id, place.id)
    } else this.storeDrift(id, place.id, answered)
    this.acceptedHeads.get(id)?.delete(place.id)
    const after = (await this.places(id)).places.find(entry => entry.id === place.id)
    return { ok: true, place: after ?? { ...place, drift: answered } }
  }

  /** A15: drift reads, own HEAD moves and answers run one at a time per conversation, in the order they were asked. */
  private inDriftQueue<T>(id: string, work: () => Promise<T>): Promise<T> {
    const next = (this.driftQueues.get(id) ?? Promise.resolve()).then(work)
    const tail = next.then(() => undefined, () => undefined)
    this.driftQueues.set(id, tail)
    void tail.then(() => { if (this.driftQueues.get(id) === tail) this.driftQueues.delete(id) })
    return next
  }

  /** A15 read points: a turn's begin and end (and places()/placeDiff()); never a timer or a watcher. */
  queuePlaceRead(id: string): void {
    void this.inDriftQueue(id, () => this.observePlaces(id)).catch(() => undefined)
  }

  private headsSeen(id: string): Map<string, ThreadPlaceHead> {
    let seen = this.lastHeads.get(id)
    if (!seen) { seen = new Map(); this.lastHeads.set(id, seen) }
    return seen
  }

  /**
   * HML 704-1: the heads seen before a shell tool ran are kept at its running event; at its end (or the turn's) a
   * place whose HEAD changed since then was moved by the conversation itself.
   */
  trackPlaceHeads(id: string, event: ThreadEvent): void {
    if (event.type === 'completed') {
      const open = this.shellTools.get(id)
      if (open?.size) void this.inDriftQueue(id, async () => {
        const before = new Map<string, ThreadPlaceHead>()
        for (const heads of open.values()) for (const [placeId, head] of heads) if (!before.has(placeId)) before.set(placeId, head)
        open.clear()
        await this.recordOwnMoves(id, before)
      }).catch(() => undefined)
      // A15 read point: the turn's end.
      this.queuePlaceRead(id)
      return
    }
    if (event.type !== 'tool' || !SHELL_TOOL.test(String(event.name))) return
    let tools = this.shellTools.get(id)
    if (!tools) { tools = new Map(); this.shellTools.set(id, tools) }
    const owner = tools
    if (event.state === 'running') {
      if (owner.has(event.id)) return
      const heads = new Map<string, ThreadPlaceHead>()
      owner.set(event.id, heads)
      void this.inDriftQueue(id, async () => { for (const [placeId, head] of this.lastHeads.get(id) ?? new Map<string, ThreadPlaceHead>()) heads.set(placeId, head) }).catch(() => undefined)
      return
    }
    const heads = owner.get(event.id)
    if (!heads) return
    const toolId = event.id
    void this.inDriftQueue(id, async () => { owner.delete(toolId); await this.recordOwnMoves(id, heads) }).catch(() => undefined)
  }

  private async recordOwnMoves(id: string, before: Map<string, ThreadPlaceHead>): Promise<void> {
    const { places } = await this.deps.placeStore.list(this.deps.readThread(id))
    const seen = this.headsSeen(id)
    for (const place of places) {
      if (place.kind === 'outside' || !place.current) continue
      const prior = before.get(place.id) ?? (place.base ? { branch: place.base.branch, commit: place.base.commit } : null)
      seen.set(place.id, place.current)
      if (!prior || sameHead(prior, place.current)) continue
      let accepted = this.acceptedHeads.get(id)
      if (!accepted) { accepted = new Map(); this.acceptedHeads.set(id, accepted) }
      accepted.set(place.id, place.current)
    }
  }

  private storeDrift(id: string, placeId: string, drift: ThreadPlaceDrift | null): void {
    this.deps.db.prepare('UPDATE thread_places SET drift_json = ? WHERE thread_id = ? AND id = ?').run(drift ? JSON.stringify(drift) : null, id, placeId)
  }

  /** The places with their drift read now; a new drift is stored and saved as one place-drift event. */
  private async observePlaces(id: string): Promise<ThreadPlaces> {
    const result = await this.deps.placeStore.list(this.deps.readThread(id))
    const shellRunning = (this.shellTools.get(id)?.size ?? 0) > 0
    const seen = this.headsSeen(id)
    const places: ThreadPlace[] = []
    for (const place of result.places) places.push(await this.observePlace(id, place, shellRunning, seen))
    return { ...result, places }
  }

  private async observePlace(id: string, place: ThreadPlace, shellRunning: boolean, seen: Map<string, ThreadPlaceHead>): Promise<ThreadPlace> {
    const base = place.base
    const current = place.current
    if (place.kind === 'outside' || !base || !current) return place
    // HML 704-4: a rebase, merge, cherry-pick or bisect in progress defers the read until it ends.
    if (await operationInProgress(place.path)) return place
    seen.set(place.id, current)
    if (shellRunning) return place
    const stored = place.drift
    const open = Boolean(stored && !stored.answer)
    // The change already recorded (or a commit on top of it): not a new one.
    if (stored && open && await headFollows(place.path, stored.to, current)) return place
    const accepted = this.acceptedHeads.get(id)?.get(place.id)
    const reference: ThreadPlaceHead = accepted ?? (stored?.answer === 'dismissed' ? stored.to : { branch: base.branch, commit: base.commit })
    const found = await readPlaceDrift({ ...place, base: { ...base, branch: reference.branch, commit: reference.commit } }, { taskMovedHead: false, panes: this.deps.paneSources(), now: Date.now() })
    if (!found) {
      if (!open) return place
      // The place went back where the conversation left it.
      this.storeDrift(id, place.id, null)
      return { ...place, drift: null }
    }
    const drift: ThreadPlaceDrift = { ...found, detached: base.branch === null }
    this.storeDrift(id, place.id, drift)
    const snapshot = this.deps.read(id)
    const eventsFrom = snapshot.events.length
    snapshot.events.push({ type: 'place-drift', placeId: place.id, from: drift.from, to: drift.to, by: drift.by, certain: false, seenAt: drift.seenAt })
    this.deps.save(snapshot, { eventsFrom })
    return { ...place, drift }
  }

  /**
   * A17 (thread:place-read, forbidden to MCP): one file in an outside or checkout place that has tool evidence, read
   * only. Every attempt, refusals included, writes one person_action_audit row; never the content.
   */
  async readPlaceFile(id: string, placeId: string, relativePath: string): Promise<ThreadPlaceReadResult> {
    const target = typeof relativePath === 'string' ? relativePath : ''
    const audit = (outcome: 'ok' | 'refused' | 'error', code?: string): void =>
      this.audit().record({ action: 'place-read', threadId: id, placeId: String(placeId), target, outcome, ...(code ? { code } : {}) })
    try {
      const { places } = await this.places(id)
      const place = places.find(entry => entry.id === placeId)
      if (!place) throw new MainMessageError(mainMessage('thread.place.gone', {}), 'This place is no longer part of the conversation.')
      const row = this.deps.db.prepare('SELECT COUNT(*) AS n FROM thread_place_writes WHERE thread_id = ? AND place_id = ?').get(id, place.id) as { n: number } | undefined
      const result = await readPlaceFileFrom(place, (row?.n ?? 0) > 0, relativePath)
      audit('ok')
      return result
    } catch (error) {
      const code = messageFromError(error)?.code
      audit(code ? 'refused' : 'error', code)
      throw error
    }
  }

  /** A14: one place's changes against its own base; an outside folder lists what was written. */
  async placeDiff(id: string, placeId: string): Promise<ThreadPlaceDiff> {
    const { places } = await this.places(id)
    const place = places.find(entry => entry.id === placeId)
    if (!place) throw new MainMessageError(mainMessage('thread.place.gone', {}), 'This place is no longer part of the conversation.')
    const rows = this.deps.db.prepare('SELECT path, kind FROM thread_place_writes WHERE thread_id = ? AND place_id = ? ORDER BY at DESC, rowid DESC')
      .all(id, place.id) as Array<{ path: string; kind: ThreadPlaceWrite['kind'] }>
    const counts = place.kind === 'outside' ? this.outsideCounts(id, place.path) : new Map<string, { additions?: number; deletions?: number }>()
    const written: ThreadPlaceWrite[] = rows.map(row => {
      const count = counts.get(row.path)
      return { path: row.path, kind: row.kind, ...(count?.additions !== undefined ? { additions: count.additions } : {}), ...(count?.deletions !== undefined ? { deletions: count.deletions } : {}) }
    })
    const diff = await placeDiffOf(place, written)
    this.deps.readThread(id)
    return diff
  }

  /** The newest additions/deletions the tool evidence gave for files written in an outside folder, by file name. */
  private outsideCounts(id: string, folder: string): Map<string, { additions?: number; deletions?: number }> {
    const counts = new Map<string, { additions?: number; deletions?: number }>()
    const target = canonicalPath(folder)
    for (const event of this.deps.read(id).events) {
      const files = event.type === 'tool' || event.type === 'turn-diff' ? event.files ?? [] : []
      for (const file of files) {
        if (typeof file.path !== 'string' || !isAbsolute(file.path)) continue
        try { if (canonicalPath(dirname(file.path)) !== target) continue } catch { continue }
        counts.set(basename(file.path), { additions: file.additions, deletions: file.deletions })
      }
    }
    return counts
  }

  /**
   * A16: where a path the conversation named opens (thread-path-resolver.ts). Reads places and the turn's cwd; never
   * creates a place. `turnId` picks that turn's cwd; the default is the newest turn.
   */
  async resolvePath(id: string, raw: string, at: { turnId?: string } = {}): Promise<ThreadPathResolution> {
    parseThreadPathInput(raw)
    const snapshot = this.deps.read(id)
    await this.deps.placeStore.idle(id)
    const places = this.deps.db.prepare(`SELECT p.id, p.kind, p.path, p.first_seen_at AS firstSeenAt,
      (SELECT MAX(w.at) FROM thread_place_writes w WHERE w.thread_id = p.thread_id AND w.place_id = p.id) AS lastWriteAt
      FROM thread_places p WHERE p.thread_id = ?`).all(id) as ThreadPathPlace[]
    return resolveThreadPath({ thread: snapshot.thread, turnCwd: this.turnCwd(id, snapshot, at.turnId), places }, raw)
  }

  /** The location reported last up to that turn (thread_turn_cwd), walking back to earlier turns that reported one. */
  private turnCwd(id: string, snapshot: ThreadSnapshot, turnId?: string): string | null {
    const turns = snapshot.turns ?? []
    let index = turnId ? turns.findIndex(turn => turn.id === turnId) : turns.length - 1
    if (index < 0) index = turns.length - 1
    const pending = this.pendingTurnCwd.get(id)
    if (pending) {
      // A cwd reported between turns belongs to the turn that followed.
      const after = pending.afterTurnId === null ? -1 : turns.findIndex(turn => turn.id === pending.afterTurnId)
      const next = turns[after + 1]
      if (next) {
        try { this.deps.db.prepare('INSERT OR IGNORE INTO thread_turn_cwd (thread_id, turn_id, cwd) VALUES (?, ?, ?)').run(id, next.id, pending.cwd) } catch { /* best effort */ }
        this.pendingTurnCwd.delete(id)
      } else if (!turnId) {
        // The next turn is not recorded yet (queued behind a finalizing turn): the cwd reported last is the newest one.
        return pending.cwd
      }
    }
    const read = this.deps.db.prepare('SELECT cwd FROM thread_turn_cwd WHERE thread_id = ? AND turn_id = ?')
    for (let at = index; at >= 0; at--) {
      const row = read.get(id, turns[at].id) as { cwd: string } | undefined
      if (row) return row.cwd
    }
    return null
  }

  /**
   * Records where the provider says it works. A worktree of the thread's repository is registered as a
   * context of the same project, so the review panels may read it; working in `rootPath` clears the record.
   * Saved only when it changes, since Codex reports a directory with every command.
   */
  storeLocation(id: string, cwd: string): void {
    try {
      const snapshot = this.deps.read(id)
      const location = resolveSessionLocation(cwd, snapshot.thread.rootPath)
      // Each checkout root the provider reports is a place, not only the last one.
      // (recorded below, after the turn's cwd, so a failure there never loses the cwd)
      if (!location) return
      this.recordTurnCwd(id, snapshot, location.cwd)
      if (location.checkoutRoot) {
        try { this.recordPlaceLocation(id, snapshot, location.checkoutRoot) } catch { /* best effort: evidence only */ }
      }
      const atRoot = location.sameRepository && location.checkoutRoot !== null && sameCheckout(location.checkoutRoot, snapshot.thread.rootPath)
      const next = atRoot ? undefined : location
      const previous = snapshot.thread.observedLocation
      if (previous?.checkoutRoot === next?.checkoutRoot && previous?.sameRepository === next?.sameRepository && (previous?.cwd === next?.cwd || next?.sameRepository)) return
      if (next?.sameRepository && next.checkoutRoot) {
        this.deps.db.prepare('INSERT OR IGNORE INTO thread_project_contexts (project_id, root_path) VALUES (?, ?)').run(snapshot.thread.projectId, next.checkoutRoot)
      }
      if (next) snapshot.thread.observedLocation = next
      else delete snapshot.thread.observedLocation
      this.deps.save(snapshot, { eventsFrom: snapshot.events.length })
      // A move during a running turn: that checkout gets its own checkpoint and baseline, so what the turn
      // changes there can be reviewed and undone like changes in the root.
      const turn = snapshot.turns?.at(-1)
      if (this.deps.isBusy(id) && turn?.status === 'running' && next?.sameRepository && next.checkoutRoot) {
        void this.deps.beginCheckpoint(id, turn.id, next.checkoutRoot, 'In a worktree').catch(() => undefined)
      }
    } catch { /* Thread may have been deleted while the provider was reporting. */ }
  }

  /**
   * The resolver's second step (A16): the cwd reported last in this turn. Only a running turn owns a cwd; one reported
   * before the next turn's record exists waits for that turn.
   */
  private recordTurnCwd(id: string, snapshot: ThreadSnapshot, cwd: string): void {
    const cwdTurn = snapshot.turns?.at(-1)
    if (cwdTurn?.status === 'running') {
      this.pendingTurnCwd.delete(id)
      try {
        this.deps.db.prepare('INSERT INTO thread_turn_cwd (thread_id, turn_id, cwd) VALUES (?, ?, ?) ON CONFLICT(thread_id, turn_id) DO UPDATE SET cwd = excluded.cwd').run(id, cwdTurn.id, cwd)
      } catch { /* best effort: the resolver then falls back to an earlier turn */ }
    } else {
      this.pendingTurnCwd.set(id, { afterTurnId: cwdTurn?.id ?? null, cwd })
    }
  }

  /** A18 · the task's Terminal tab: panes whose newest known cwd is in one of its places; computed, never stored. */
  async panes(id: string): Promise<ThreadPane[]> {
    const { places } = await this.deps.placeStore.list(this.deps.readThread(id))
    return threadPanes(places, this.deps.paneSources())
  }

  /**
   * A54: files this conversation wrote that are still dirty and that another non-archived conversation also wrote and
   * left dirty in the same checkout. Computed on every call (one git status per checkout), never stored.
   */
  async collisions(id: string): Promise<ThreadCollision[]> {
    this.deps.readThread(id)
    const threads = (this.deps.db.prepare(`SELECT id, json_extract(data_json, '$.title') AS title, json_extract(data_json, '$.archived') AS archived
      FROM conversation_threads`).all() as { id: string; title: string | null; archived: unknown }[])
      .filter(row => row.id === id || !row.archived)
    await Promise.all(threads.map(row => this.deps.placeStore.idle(row.id)))
    return threadCollisions(this.deps.db, id, threads.map(row => ({ id: row.id, title: readThreadTitle(row.title) })))
  }

  collectPlaceEvidence(id: string, snapshot: ThreadSnapshot, event: ThreadEvent): void {
    const evidence = placeEvidenceOf(event)
    if (evidence) this.deps.placeStore.record(snapshot.thread, evidence.key, evidence.items, this.placeTurn(id, snapshot))
  }

  private recordPlaceLocation(id: string, snapshot: ThreadSnapshot, checkoutRoot: string): void {
    const turn = this.placeTurn(id, snapshot)
    this.deps.placeStore.record(snapshot.thread, `location:${canonicalPath(checkoutRoot)}:${turn?.turnId ?? ''}`, [{ path: checkoutRoot, mode: 'location' }], turn)
  }

  /** The running turn evidence arrives in, if any; a place first touched there gets its base. */
  private placeTurn(id: string, snapshot: ThreadSnapshot): PlaceTurn | null {
    const turn = snapshot.turns?.at(-1)
    if (!turn || turn.status !== 'running') return null
    const turnId = turn.id
    return { turnId, running: () => {
      if (!this.deps.isBusy(id)) return false
      try { const latest = this.deps.read(id).turns?.at(-1); return latest?.id === turnId && latest.status === 'running' } catch { return false }
    } }
  }

  /** In-memory place state of a conversation that no longer exists. */
  forget(id: string): void {
    this.deps.placeStore.forget(id)
    this.lastHeads.delete(id); this.shellTools.delete(id); this.acceptedHeads.delete(id)
  }
}
