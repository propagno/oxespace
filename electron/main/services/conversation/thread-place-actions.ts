import type { AppDatabase } from '../../db'
import type { ThreadPlace, ThreadPlaceActionResult, ThreadPlaceDiff, ThreadPlaces, ThreadPlaceUndoInput, ThreadPlaceUndoResult } from '../../../../shared/types/thread-places'
import { mainMessage } from '../../../../shared/messages'
import { PersonActionAudit, type PersonAction } from '../person-action-audit'
import { discardPlace, PlaceRestoreTokens, refusePlace, restorePlaceChange, undoPlaceChange, withPlaceMtimes } from './thread-place-undo'

/**
 * A14 on a conversation's places, for ThreadOrchestrator: Undo a file or hunk, Restore it once, Discard a place, and the
 * diff's file mtimes that Undo checks against. Person-only, never MCP; one audit row per attempt (SECURITY S5).
 */
export class ThreadPlaceActions {
  /** A14 Undo: restore data in memory only, never the DB or the audit. */
  private readonly restoreTokens = new PlaceRestoreTokens()
  /** SECURITY S5: the person's actions on places (undo, restore, discard). */
  private personAudit?: PersonActionAudit

  /** `database` is read on use: the orchestrator builds this in a field initializer, before its own `db` is set. */
  constructor(private readonly database: () => AppDatabase, private readonly places: (id: string) => Promise<ThreadPlaces>) {}

  private get db(): AppDatabase { return this.database() }

  /** A14: the place diff with each file's mtime, so Undo can refuse a file changed since it was read. */
  async withMtimes(diff: Promise<ThreadPlaceDiff>): Promise<ThreadPlaceDiff> { return withPlaceMtimes(await diff) }

  /** Restore tokens end at the conversation's next turn, and when it is forgotten. */
  dropThread(id: string): void { this.restoreTokens.dropThread(id) }

  private placeAudit(action: PersonAction, id: string, placeId: unknown, target: string, outcome: 'ok' | 'refused' | 'error', code?: string): void {
    (this.personAudit ??= new PersonActionAudit(this.db)).record({ action, threadId: id, placeId: String(placeId ?? ''), target, outcome, ...(code ? { code } : {}) })
  }

  /** The paths the task wrote in this place (thread_place_writes), relative to it. */
  private placeWrites(id: string, placeId: string): string[] {
    return (this.db.prepare('SELECT path FROM thread_place_writes WHERE thread_id = ? AND place_id = ?').all(id, placeId) as Array<{ path: string }>).map(row => row.path)
  }

  private async findPlace(id: string, placeId: string): Promise<ThreadPlace | undefined> {
    return (await this.places(id)).places.find(entry => entry.id === placeId)
  }

  /**
   * A14 Undo (person-only, never MCP): one file or hunk the task wrote in a git place back to its base. One audit row
   * per attempt (place-undo, target = path), refusals included; never the content.
   */
  async undo(id: string, placeId: string, input: ThreadPlaceUndoInput): Promise<ThreadPlaceUndoResult> {
    const target = typeof input?.path === 'string' ? input.path : ''
    const audit = (outcome: 'ok' | 'refused' | 'error', code?: string): void => this.placeAudit('place-undo', id, placeId, target, outcome, code)
    try {
      const place = await this.findPlace(id, placeId)
      if (!place) { audit('refused', 'thread.place.gone'); return { ok: false, refusal: mainMessage('thread.place.gone', {}) } }
      const result = await undoPlaceChange(place, { path: target, ...(typeof input.hunk === 'string' ? { hunk: input.hunk } : {}),
        seenMtime: typeof input.seenMtime === 'number' ? input.seenMtime : null, written: this.placeWrites(id, place.id) })
      if (!result.ok) { audit('refused', result.refusal.code); return result }
      audit('ok')
      return { ok: true, restoreToken: this.restoreTokens.issue({ threadId: id, placeId: place.id, path: target, forward: result.forward }) }
    } catch (error) { audit('error'); throw error }
  }

  /** A14 Restore: the undone change back, once; the token is single use, bound to thread and place, short-lived. */
  async restore(id: string, token: string): Promise<ThreadPlaceActionResult> {
    const held = this.restoreTokens.take(id, token)
    if (!held) { this.placeAudit('place-restore', id, '', '', 'refused', 'thread.place.restoreGone'); return refusePlace('thread.place.restoreGone') }
    const audit = (outcome: 'ok' | 'refused' | 'error', code?: string): void => this.placeAudit('place-restore', id, held.placeId, held.path, outcome, code)
    try {
      const place = await this.findPlace(id, held.placeId)
      if (!place) { audit('refused', 'thread.place.gone'); return { ok: false, refusal: mainMessage('thread.place.gone', {}) } }
      const result = await restorePlaceChange(place, held.forward, held.path)
      if (!result.ok) { audit('refused', result.refusal.code); return result }
      audit('ok')
      return { ok: true }
    } catch (error) { audit('error'); throw error }
  }

  /** A14 Discard: every file the task wrote in a git place back to its base, after the person confirmed. */
  async discard(id: string, placeId: string, input: { confirmed?: boolean }): Promise<ThreadPlaceActionResult> {
    let target = ''
    const audit = (outcome: 'ok' | 'refused' | 'error', code?: string): void => this.placeAudit('place-discard', id, placeId, target, outcome, code)
    try {
      const place = await this.findPlace(id, placeId)
      if (!place) { audit('refused', 'thread.place.gone'); return { ok: false, refusal: mainMessage('thread.place.gone', {}) } }
      target = place.path
      if (place.kind === 'outside') { audit('refused', 'thread.place.outside'); return refusePlace('thread.place.outside') }
      if (input?.confirmed !== true) { audit('refused', 'thread.place.confirm'); return refusePlace('thread.place.confirm') }
      const result = await discardPlace(place, this.placeWrites(id, place.id))
      if (!result.ok) { audit('refused', result.refusal.code); return result }
      audit('ok')
      return { ok: true }
    } catch (error) { audit('error'); throw error }
  }
}
