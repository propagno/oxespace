import { MoreHorizontal, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ContainerEngine, ContainerPanel, ContainerPanelRow } from '../../../shared/types/oxepod'
import type { DatabaseEngine } from '../../../shared/types/oxequery'
import { openExternalLink } from '../../lib/externalLinks'
import { Avatar, Button, EmptyState, Menu, Notice, StatusDot, ToolPanel, copyText, toast, useModalSurface, type MenuEntry } from '../../ui'
import { requestOxeQueryConnect } from '../OxeQuery/oxequery-bridge'
import './ContainersPanel.css'

const DOCKER_INSTALL_URL = 'https://docs.docker.com/get-docker/'

function ConfirmPrompt({
  title,
  description,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm
}: {
  title: string
  description: string
  cancelLabel: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}): ReactElement {
  const surface = useModalSurface<HTMLDivElement>(onCancel)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descId = useId()
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])
  return (
    <div className="containers-confirm-overlay" role="presentation" onMouseDown={onCancel}>
      <div
        className="containers-confirm-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        {...surface}
        onMouseDown={event => event.stopPropagation()}
      >
        <h3 id={titleId}>{title}</h3>
        <p id={descId}>{description}</p>
        <div className="containers-confirm-actions">
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}

export interface ContainersPanelProps {
  onOpenConversation?: (id: string) => void
  onClose?: () => void
}

export function ContainersPanel({ onOpenConversation, onClose }: ContainersPanelProps): ReactElement {
  const { t } = useTranslation('code')
  const [panel, setPanel] = useState<ContainerPanel | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  useEffect(() => { void window.oxe?.featureUsage?.record?.('containersPanel') }, [])
  const [confirm, setConfirm] = useState<{ kind: 'stack' | 'remove'; row: ContainerPanelRow } | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const res = await window.oxe?.oxePod?.call('containers.panel', {})
    if (res?.ok && res.value) setPanel(res.value as ContainerPanel)
  }, [])

  useEffect(() => {
    void refresh()
    return window.oxe?.oxePod?.onEvent(event => {
      if (event.type === 'containers-changed') void refresh()
    })
  }, [refresh])

  const rows = panel?.rows ?? []
  const selected = rows.find(row => row.id === selectedId) ?? rows[0] ?? null

  useEffect(() => {
    if (!selected || panel?.engine.state !== 'ready') {
      setLogs([])
      return
    }
    let active = true
    let streamId: string | null = null
    setLogs([])
    const off = window.oxe?.oxePod?.onEvent(event => {
      if (active && event.type === 'container-log' && streamId && event.streamId === streamId) {
        setLogs(prev => [...prev, ...event.lines].slice(-200))
      }
    })
    void window.oxe?.oxePod?.call('containers.logsStart', { id: selected.id }).then(res => {
      const id = (res?.ok ? (res.value as { streamId?: string } | undefined)?.streamId : undefined) ?? null
      if (!id) return
      if (!active) {
        void window.oxe?.oxePod?.call('containers.logsStop', { streamId: id })
        return
      }
      streamId = id
    })
    return () => {
      active = false
      off?.()
      if (streamId) void window.oxe?.oxePod?.call('containers.logsStop', { streamId })
    }
  }, [panel?.engine.state, selected?.id])

  const wrap = (body: ReactElement): ReactElement => {
    if (!onClose) return <div className="containers-panel">{body}</div>
    return (
      <ToolPanel label={t('panels.containers')} onClose={onClose} toasts>
        <div className="containers-panel containers-panel-modal">
          <header className="containers-panel-header">
            <h2>{t('panels.containers')}</h2>
            <Button size="sm" variant="ghost" aria-label={t('ui.close', { ns: 'common' })} onClick={onClose}>
              <X size={14} aria-hidden="true" />
            </Button>
          </header>
          {body}
        </div>
      </ToolPanel>
    )
  }

  if (panel && panel.engine.state !== 'ready') {
    const engineKey: ContainerEngine = panel.engine.engine === 'podman' ? 'podman' : 'docker'
    const engineName = t(`containers.engineName.${engineKey}`)
    if (panel.engine.state === 'missing') {
      return wrap(
        <div className="containers-panel-notice">
          <Notice
            intent="warning"
            title={t('containers.engine.missingTitle', { engine: engineName })}
            actions={<Button size="sm" onClick={() => void openExternalLink(DOCKER_INSTALL_URL, { source: 'app' })}>{t('containers.howToInstall')}</Button>}
          >
            <p>{t('containers.engine.missingBody')}</p>
          </Notice>
        </div>
      )
    }
    const titleKey = panel.engine.state === 'denied' ? 'containers.engine.deniedTitle' : 'containers.engine.stoppedTitle'
    const bodyKey = panel.engine.state === 'denied' ? 'containers.engine.deniedBody' : 'containers.engine.stoppedBody'
    return wrap(
      <div className="containers-panel-notice">
        <Notice
          intent="warning"
          title={t(titleKey, { engine: engineName })}
          actions={<Button size="sm" onClick={() => void refresh()}>{t('containers.tryAgain')}</Button>}
        >
          <p>{t(bodyKey, { engine: engineName })}</p>
        </Notice>
      </div>
    )
  }

  if (panel && rows.length === 0) {
    return wrap(<EmptyState compact title={t('containers.empty')} />)
  }

  const stopRow = async (row: ContainerPanelRow): Promise<void> => {
    await window.oxe?.oxePod?.call('containers.action', { id: row.id, action: 'stop' })
    void refresh()
    toast({
      title: t('containers.stoppedToast', { name: row.name }),
      action: {
        label: t('containers.undo'),
        run: () => {
          void window.oxe?.oxePod?.call('containers.action', { id: row.id, action: 'start' }).then(() => refresh())
        }
      }
    })
  }

  const runAction = async (id: string, action: 'start' | 'restart'): Promise<void> => {
    await window.oxe?.oxePod?.call('containers.action', { id, action })
    void refresh()
  }

  const connectInOxeQuery = async (row: ContainerPanelRow): Promise<void> => {
    const res = await window.oxe?.oxePod?.call('containers.suggestConnection', { id: row.id })
    const suggestion = res?.ok
      ? (res.value as { engine: DatabaseEngine; name: string; host: string; port: number; database: string; username: string } | null)
      : null
    if (!suggestion) return
    requestOxeQueryConnect({
      draft: {
        engine: suggestion.engine,
        name: suggestion.name,
        host: suggestion.host,
        port: suggestion.port,
        database: suggestion.database,
        username: suggestion.username,
        containerRef: row.name
      }
    })
    onClose?.()
  }

  const confirmPending = async (): Promise<void> => {
    if (!confirm) return
    const target = confirm
    setConfirm(null)
    if (target.kind === 'stack') {
      await window.oxe?.oxePod?.call('containers.compose', { id: target.row.id, action: 'stop', confirmed: true })
    } else {
      await window.oxe?.oxePod?.call('containers.remove', { id: target.row.id, confirmed: true })
    }
    void refresh()
  }

  const stacks = new Map<string, ContainerPanelRow[]>()
  const standalone: ContainerPanelRow[] = []
  for (const row of rows) {
    if (row.stack) {
      const group = stacks.get(row.stack) ?? []
      group.push(row)
      stacks.set(row.stack, group)
    } else {
      standalone.push(row)
    }
  }

  const renderRow = (row: ContainerPanelRow): ReactElement => {
    const running = row.status === 'running'
    const origin = row.startedBy
    return (
      <li key={row.id} data-selected={selected?.id === row.id || undefined} onClick={() => setSelectedId(row.id)}>
        <StatusDot status={running ? 'running' : 'idle'} label={running ? t('containers.statusRunning') : t('containers.statusStopped')} />
        <button type="button" className="containers-row-name" onClick={() => setSelectedId(row.id)}>
          <span>{row.name}</span>
        </button>
        {origin?.kind === 'conversation' ? (
          <button
            type="button"
            className="containers-row-origin"
            onClick={event => {
              event.stopPropagation()
              onOpenConversation?.(origin.conversationId)
            }}
          >
            <Avatar name={origin.provider} size={16} />
            <span>{origin.title}</span>
          </button>
        ) : origin?.kind === 'person' ? (
          <span className="containers-row-origin">{t('containers.startedByYou')}</span>
        ) : (
          <span className="text-muted" title={t('containers.outsideHint')}>{t('containers.outside')}</span>
        )}
      </li>
    )
  }

  const menuItems: MenuEntry[] = selected ? [
    { label: t('containers.openShell'), onSelect: () => { void window.oxe?.oxePod?.call('containers.shell', { id: selected.id }) } },
    { label: t('containers.copyId'), onSelect: () => { void copyText(selected.id) } },
    ...(selected.isDatabase ? [{ label: t('containers.connectInOxeQuery'), onSelect: () => { void connectInOxeQuery(selected) } }] : []),
    ...(selected.stack !== null ? [{ label: t('containers.stopStack'), onSelect: () => setConfirm({ kind: 'stack', row: selected }) }] : []),
    { label: t('containers.removeContainer'), danger: true, onSelect: () => setConfirm({ kind: 'remove', row: selected }) }
  ] : []

  return wrap(
    <div className="containers-panel-body">
      <div className="containers-panel-list">
        {[...stacks.entries()].map(([stack, group]) => (
          <div key={stack} className="containers-stack-group" role="group" aria-label={stack}>
            <h4>{stack}</h4>
            <ul>{group.map(renderRow)}</ul>
          </div>
        ))}
        {standalone.length > 0 && <ul>{standalone.map(renderRow)}</ul>}
      </div>
      {selected && (
        <section className="containers-panel-detail" aria-label={t('containers.detailLabel')}>
          <div className="containers-panel-meta">
            <span>{selected.status === 'running' ? t('containers.statusRunning') : t('containers.statusStopped')}</span>
            <span>{selected.image}</span>
          </div>
          <div className="containers-panel-actions">
            {selected.status === 'running' ? (
              <Button size="sm" onClick={() => void stopRow(selected)}>{t('containers.stop')}</Button>
            ) : (
              <Button size="sm" onClick={() => void runAction(selected.id, 'start')}>{t('containers.start')}</Button>
            )}
            <Button size="sm" onClick={() => void runAction(selected.id, 'restart')}>{t('containers.restart')}</Button>
            <Menu
              label={t('containers.moreActions')}
              align="end"
              items={menuItems}
              trigger={
                <Button size="sm" variant="ghost" aria-label={t('containers.moreActions')}>
                  <MoreHorizontal size={14} aria-hidden="true" />
                </Button>
              }
            />
          </div>
          <pre className="containers-panel-logs">{logs.length > 0 ? logs.join('\n') : t('containers.noLogs')}</pre>
        </section>
      )}
      {confirm && (
        <ConfirmPrompt
          title={confirm.kind === 'stack'
            ? t('containers.confirmStopStackTitle', { stack: confirm.row.stack ?? '' })
            : t('containers.confirmRemoveTitle', { name: confirm.row.name })}
          description={confirm.kind === 'stack'
            ? t('containers.confirmStopStackBody', { stack: confirm.row.stack ?? '' })
            : t('containers.confirmRemoveBody')}
          cancelLabel={t('ui.cancel', { ns: 'common' })}
          confirmLabel={confirm.kind === 'stack' ? t('containers.confirmStopStackAction') : t('containers.confirmRemoveAction')}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void confirmPending()}
        />
      )}
    </div>
  )
}
