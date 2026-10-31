import { toast } from '../ui/Toast'
import { i18n } from '../i18n'
import { humanizeError } from '../utils/humanizeError'

type SetState<S> = (partial: Partial<S>) => void
type GetState<S> = () => S

export interface OptimisticOptions<S, R> {
  /** Toast title when the change could not be saved, e.g. "Could not pin conversation". */
  rollbackMessage: string
  /** Folds the server's answer into the state once the change is saved. */
  reconcile?: (result: R, state: S) => Partial<S> | void
  /**
   * Undoes the change against the current state. Without it the keys `apply` wrote go back to the values they held
   * before, which is right for fields nobody else writes meanwhile. Pass it when other updates can land on the same
   * field (a streamed list, say), so the rollback only undoes this change.
   */
  revert?: (state: S) => Partial<S>
  /**
   * Rethrow the failure instead of showing the toast. For callers that already show the error next to the control
   * that started the change (a form, for instance).
   */
  rethrow?: boolean
}

/**
 * Shows a change at once and saves it in the background: snapshot → apply → await → reconcile, or restore.
 * When saving fails the change is undone and a danger toast offers "Try again", which runs the whole change again.
 * Resolves to the server's answer, or undefined when the change was rolled back.
 */
export async function optimistic<S extends object, R>(
  set: SetState<S>,
  get: GetState<S>,
  apply: (state: S) => Partial<S>,
  commit: () => Promise<R>,
  options: OptimisticOptions<S, R>
): Promise<R | undefined> {
  const before = get()
  const patch = apply(before)
  const snapshot = Object.fromEntries(Object.keys(patch).map(key => [key, before[key as keyof S]])) as Partial<S>
  set(patch)
  try {
    const result = await commit()
    const reconciled = options.reconcile?.(result, get())
    if (reconciled) set(reconciled)
    return result
  } catch (error) {
    set(options.revert ? options.revert(get()) : snapshot)
    if (options.rethrow) throw error
    toast({
      title: options.rollbackMessage,
      description: humanizeError(error, i18n.t('ui.changeNotSaved')),
      intent: 'danger',
      action: { label: i18n.t('ui.tryAgain'), run: () => void optimistic(set, get, apply, commit, options) }
    })
    return undefined
  }
}
