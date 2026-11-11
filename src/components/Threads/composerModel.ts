import { i18n } from '../../i18n'

export type ComposerHintStatus = 'idle' | 'working' | 'needs-you'

export function composerHints(state: {
  status: ComposerHintStatus | string
  canSteer: boolean
}): { placeholder: string; steer: boolean; sendNow: boolean } {
  if (state.status === 'needs-you') {
    return {
      placeholder: i18n.t('thread:composerModel.needsYou'),
      steer: false,
      sendNow: true
    }
  }
  if (state.status === 'working') {
    if (state.canSteer) {
      return {
        placeholder: i18n.t('thread:composerModel.steer'),
        steer: true,
        sendNow: true
      }
    }
    return {
      placeholder: i18n.t('thread:composerModel.queued'),
      steer: false,
      sendNow: true
    }
  }
  return {
    placeholder: i18n.t('thread:composerModel.idle'),
    steer: false,
    sendNow: true
  }
}

export function modelChipState(state: {
  active: string
  next: string | null
}): { pending: boolean; note: string | null } {
  const pending = Boolean(state.next && state.next !== state.active)
  return {
    pending,
    note: pending ? i18n.t('thread:composerModel.appliesNext') : null
  }
}
