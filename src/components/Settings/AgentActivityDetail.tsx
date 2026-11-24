import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button, IconButton, useModalSurface } from '../../ui'
import { useUIStore } from '../../store/ui.store'
import { resolvePreferredOpenInTarget } from '../../lib/openIn'
import { changeInWorkingTree, liveContainer } from './agentActivityLive'
import type { OpenInInput } from '../../../shared/types/open-in'

interface AgentActivityDetailProps {
  row: Record<string, unknown>
  onClose: () => void
}

export function AgentActivityDetail({ row, onClose }: AgentActivityDetailProps): ReactElement {
  const { t } = useTranslation('settings')
  const surface = useModalSurface<HTMLDivElement>(onClose)

  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [inWorkingTree, setInWorkingTree] = useState<boolean | null>(null)
  const [containerInfo, setContainerInfo] = useState<{ image: string; ports: string; folder: string } | null | undefined>(undefined)

  const source = String(row.source ?? '')
  const title = String(row.summary ?? '')

  useEffect(() => {
    let active = true
    const id = String(row.id ?? '')
    if (window.oxe?.agentActivity?.detail) {
      window.oxe.agentActivity.detail(id).then((d: unknown) => {
        if (active && d && typeof d === 'object') {
          setDetail(d as Record<string, unknown>)
        }
      }).catch(() => {})
    }
    return () => { active = false }
  }, [row.id])

  useEffect(() => {
    let active = true
    if (source === 'changes') {
      const workspaceId = String(row.workspaceId ?? '')
      const path = String(row.path ?? row.summary ?? '')
      if (workspaceId && path) {
        changeInWorkingTree(workspaceId, path).then((res) => {
          if (active) setInWorkingTree(res)
        }).catch(() => {
          if (active) setInWorkingTree(false)
        })
      } else {
        setInWorkingTree(false)
      }
    } else if (source === 'containers') {
      const name = String(row.target || row.summary || '').replace(/^(start|stop|restart|logs|exec)\s+/i, '')
      liveContainer(name).then((res) => {
        if (active) setContainerInfo(res)
      }).catch(() => {
        if (active) setContainerInfo(null)
      })
    }
    return () => { active = false }
  }, [source, row])

  const line = detail?.line ?? row.line
  const path = String(detail?.path ?? row.path ?? row.summary ?? '')
  const workspaceId = String(row.workspaceId ?? '')

  const handleOpenInEditor = async (): Promise<void> => {
    if (window.oxe?.app?.openIn) {
      const target = await resolvePreferredOpenInTarget()
      const input: OpenInInput = {
        workspaceId,
        rootPath: '',
        path,
        target,
        ...(line ? { line: Number(line) } : {})
      }
      window.oxe.app.openIn(input)
    }
  }

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal-content agent-activity-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        {...surface}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <IconButton
            label={t('common:close', { defaultValue: 'Close' })}
            icon={<X size={16} />}
            size="sm"
            onClick={onClose}
          />
        </div>

        <div className="modal-body">
          {source === 'databases' && (
            <div className="agent-activity-detail-section">
              <p>
                <strong>{t('activity.connection', { defaultValue: 'Connection' })}:</strong>{' '}
                {String(detail?.connectionName ?? detail?.connectionId ?? row.target ?? '')}
              </p>
              {detail?.engine ? (
                <p>
                  <strong>{t('activity.engine', { defaultValue: 'Engine' })}:</strong> {String(detail.engine)}
                </p>
              ) : null}
              {detail?.text ? (
                <pre className="agent-activity-sql">{String(detail.text)}</pre>
              ) : null}
            </div>
          )}

          {source === 'changes' && (
            <div className="agent-activity-detail-section">
              {inWorkingTree === false ? (
                <p className="settings-field-hint">
                  {t('activity.changeGone', {
                    defaultValue: "This change isn't in the working tree any more: it was committed, undone or moved."
                  })}
                </p>
              ) : inWorkingTree === true ? (
                <div className="agent-activity-actions">
                  <Button variant="primary" onClick={() => void handleOpenInEditor()}>
                    {t('activity.openInEditor', {
                      line: line ?? 1,
                      defaultValue: `Open in editor at line ${line ?? 1}`
                    })}
                  </Button>
                </div>
              ) : null}
            </div>
          )}

          {source === 'containers' && (
            <div className="agent-activity-detail-section">
              {containerInfo === null ? (
                <p className="settings-field-hint">
                  {t('activity.containerGone', {
                    defaultValue: 'This container was removed. Only its name and start time are kept.'
                  })}
                </p>
              ) : containerInfo ? (
                <div className="agent-activity-container-info">
                  <p>
                    <strong>{t('activity.image', { defaultValue: 'Image' })}:</strong> {containerInfo.image}
                  </p>
                  {containerInfo.ports && (
                    <p>
                      <strong>{t('activity.ports', { defaultValue: 'Ports' })}:</strong> {containerInfo.ports}
                    </p>
                  )}
                  {containerInfo.folder && (
                    <p>
                      <strong>{t('activity.folder', { defaultValue: 'Folder' })}:</strong> {containerInfo.folder}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {source === 'http' && (
            <div className="agent-activity-detail-section">
              <p>
                <strong>{t('activity.target', { defaultValue: 'Target' })}:</strong> {String(row.target ?? '')}
              </p>
              {row.status != null && (
                <p>
                  <strong>{t('activity.status', { defaultValue: 'Status' })}:</strong> {String(row.status)}
                </p>
              )}
              <div className="agent-activity-actions">
                <Button
                  variant="secondary"
                  onClick={() => {
                    onClose()
                    useUIStore.getState().openSettingsPage('agent-permissions')
                  }}
                >
                  {t('activity.blockHost')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
