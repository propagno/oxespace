import { useRef, type ReactElement } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Menu } from '../../ui'
import { modelChipState } from './composerModel'

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value
}

export function ComposerChips(props: {
  mode: string
  model: string
  models: string[]
  nextModel: string | null
  effort?: string
  efforts?: string[]
  access: string
  onChange: (change: Record<string, unknown>) => void
}): ReactElement {
  const { mode, model, models, nextModel, effort, efforts, access, onChange } = props
  const { t } = useTranslation('thread')
  const modelRef = useRef<HTMLButtonElement>(null)
  const effortRef = useRef<HTMLButtonElement>(null)
  const accessRef = useRef<HTMLButtonElement>(null)

  const modelState = modelChipState({ active: model, next: nextModel })
  const displayedModel = nextModel ?? model
  const isPlan = mode === 'plan'

  const accessLabel =
    access === 'full' || access === 'full-access'
      ? t('subline.accessFull')
      : access === 'read' || access === 'read-only'
        ? t('subline.accessRead')
        : t('subline.accessEdit')

  const returnFocus = (ref: { current: HTMLButtonElement | null }): void => {
    requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) {
        ref.current?.focus()
      }
    })
  }

  return (
    <div className="thread-configuration" aria-label={t('config.label')}>
      <div className="thread-mode-toggle" role="group" aria-label={t('config.mode')}>
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={isPlan}
          onClick={() => onChange({ mode: 'plan' })}
        >
          {t('config.plan')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={!isPlan}
          onClick={() => onChange({ mode: 'agent' })}
        >
          {t('config.agent')}
        </Button>
      </div>

      <Menu
        label={t('config.selectModel')}
        side="top"
        onOpenChange={open => { if (!open) returnFocus(modelRef) }}
        items={[
          {
            type: 'radio',
            value: displayedModel,
            options: models.map(option => ({ value: option, label: option })),
            onValueChange: value => {
              onChange({ model: value })
              requestAnimationFrame(() => modelRef.current?.focus())
            }
          }
        ]}
        trigger={
          <Button
            ref={modelRef}
            size="sm"
            variant="ghost"
            className="thread-chip is-model"
            data-pending={modelState.pending ? 'true' : undefined}
          >
            <span>{displayedModel}</span>
            <ChevronDown size={12} aria-hidden="true" />
          </Button>
        }
      />

      {efforts && efforts.length > 0 && (
        <Menu
          label={t('config.selectEffort')}
          side="top"
          onOpenChange={open => { if (!open) returnFocus(effortRef) }}
          items={[
            {
              type: 'radio',
              value: effort ?? efforts[0],
              options: efforts.map(option => ({ value: option, label: capitalize(option) })),
              onValueChange: value => {
                onChange({ effort: value })
                requestAnimationFrame(() => effortRef.current?.focus())
              }
            }
          ]}
          trigger={
            <Button ref={effortRef} size="sm" variant="ghost" className="thread-chip is-effort">
              <span>{effort ? capitalize(effort) : t('config.automatic')}</span>
              <ChevronDown size={12} aria-hidden="true" />
            </Button>
          }
        />
      )}

      <Menu
        label={t('config.permissions')}
        side="top"
        onOpenChange={open => { if (!open) returnFocus(accessRef) }}
        items={[
          {
            type: 'radio',
            value: access,
            options: [
              { value: 'read', label: t('subline.accessRead') },
              { value: 'edit', label: t('subline.accessEdit') },
              { value: 'full', label: t('subline.accessFull') }
            ],
            onValueChange: value => {
              onChange({ access: value })
              requestAnimationFrame(() => accessRef.current?.focus())
            }
          }
        ]}
        trigger={
          <Button ref={accessRef} size="sm" variant="ghost" className="thread-chip is-permissions">
            <span>{accessLabel}</span>
            <ChevronDown size={12} aria-hidden="true" />
          </Button>
        }
      />

      {modelState.pending && modelState.note && (
        <small className="thread-config-pending">{modelState.note}</small>
      )}
    </div>
  )
}
