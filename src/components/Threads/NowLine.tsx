import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThreadActivity, ThreadActivityVerb } from '../../../shared/types/agents'

export type NowLineAction = 'deny' | 'allow' | 'see-impact' | 'answer' | 'stop' | 'retry' | 'open-pr'

type VerbI18nKey =
  | 'nowLine.verbs.editing'
  | 'nowLine.verbs.running'
  | 'nowLine.verbs.reading'
  | 'nowLine.verbs.querying'
  | 'nowLine.verbs.calling'
  | 'nowLine.verbs.starting'
  | 'nowLine.verbs.thinking'

const VERB_KEYS: Partial<Record<ThreadActivityVerb | string, VerbI18nKey>> = {
  edit: 'nowLine.verbs.editing',
  editing: 'nowLine.verbs.editing',
  run: 'nowLine.verbs.running',
  running: 'nowLine.verbs.running',
  read: 'nowLine.verbs.reading',
  reading: 'nowLine.verbs.reading',
  query: 'nowLine.verbs.querying',
  querying: 'nowLine.verbs.querying',
  http: 'nowLine.verbs.calling',
  calling: 'nowLine.verbs.calling',
  container: 'nowLine.verbs.starting',
  starting: 'nowLine.verbs.starting',
  think: 'nowLine.verbs.thinking'
}

function stripEndDot(value: string | undefined): string {
  return (value ?? '').replace(/[*_`]+$/g, '').trim().replace(/\.+$/, '')
}

function lowerVerbStart(value: string): string {
  return /^[A-Z][a-zÀ-ÿ]/.test(value) ? value[0].toLowerCase() + value.slice(1) : value
}

export function NowLine(props: {
  activity: ThreadActivity
  agent: string
  irreversible?: boolean
  hasPullRequest?: boolean
  onAction(action: NowLineAction): void
}): ReactElement {
  const { activity, agent, irreversible = false, hasPullRequest = false, onAction } = props
  const { t } = useTranslation('thread')

  let copy = ''
  let buttons: Array<{ action: NowLineAction; label: string; danger?: boolean }> = []

  switch (activity.kind) {
    case 'needs-you': {
      const request = lowerVerbStart(stripEndDot(activity.text))
      copy = request ? t('nowLine.needsYou', { agent, request }) : t('nowLine.needsYouShort', { agent })
      buttons = irreversible
        ? [
            { action: 'deny', label: t('nowLine.actions.deny'), danger: true },
            { action: 'see-impact', label: t('nowLine.actions.seeImpact') }
          ]
        : [
            { action: 'deny', label: t('nowLine.actions.deny'), danger: true },
            { action: 'allow', label: t('nowLine.actions.allow') }
          ]
      break
    }
    case 'question': {
      const count = typeof activity.count === 'number' && activity.count > 0 ? activity.count : 1
      copy = t('nowLine.question', { agent, count })
      buttons = [{ action: 'answer', label: t('nowLine.actions.answer') }]
      break
    }
    case 'working': {
      const verbKey = activity.verb ? VERB_KEYS[activity.verb] : undefined
      const target = stripEndDot(activity.text)
      if (verbKey && target) {
        copy = t('nowLine.workingVerb', { verb: t(verbKey), target })
      } else if (verbKey) {
        copy = t('nowLine.workingVerbOnly', { verb: t(verbKey) })
      } else if (target) {
        copy = t('nowLine.workingText', { text: target })
      } else {
        copy = t('nowLine.workingShort')
      }
      if (typeof activity.since === 'number' && Number.isFinite(activity.since)) {
        const minutes = Math.max(1, Math.round((Date.now() - activity.since) / 60_000))
        copy = `${copy} · ${t('subline.elapsedMin', { minutes })}`
      }
      buttons = [{ action: 'stop', label: t('nowLine.actions.stop'), danger: true }]
      break
    }
    case 'paused': {
      copy = t('nowLine.paused')
      break
    }
    case 'error': {
      const reason = stripEndDot(activity.reason ?? activity.text)
      copy = reason ? t('nowLine.error', { reason }) : t('nowLine.errorShort')
      buttons = [{ action: 'retry', label: t('nowLine.actions.retry') }]
      break
    }
    case 'ready': {
      const summary = stripEndDot(activity.text)
      copy = summary ? t('nowLine.ready', { summary }) : t('nowLine.readyShort')
      if (hasPullRequest) {
        buttons = [{ action: 'open-pr', label: t('nowLine.actions.openPr') }]
      }
      break
    }
    case 'done': {
      const summary = stripEndDot(activity.text)
      copy = summary ? t('nowLine.done', { summary }) : t('nowLine.doneShort')
      break
    }
  }

  const leadEnd = copy.indexOf('. ')
  return (
    <div className="thread-now-line" data-kind={activity.kind}>
      <p role="status" className="thread-now-line-copy">
        {leadEnd > 0 ? <><strong>{copy.slice(0, leadEnd + 1)}</strong>{copy.slice(leadEnd + 1)}</> : <strong>{copy}</strong>}
      </p>
      {buttons.length > 0 && (
        <div className="thread-now-line-actions">
          {buttons.slice(0, 2).map(item => (
            <button
              key={item.action}
              type="button"
              className="thread-now-line-action"
              data-danger={item.danger ? 'true' : undefined}
              onClick={() => onAction(item.action)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
