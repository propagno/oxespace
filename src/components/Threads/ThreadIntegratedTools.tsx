import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { CONFIGURABLE_MCP_TOOL_GROUPS, type McpToolGroupInfo, type McpToolGroupMode } from '../../../shared/types/mcp-tools'
import type { ThreadMcpServerStatus } from '../../../shared/types/thread'
import { useUIStore } from '../../store/ui.store'
import { Badge, Button } from '../../ui'
import styles from './ThreadSessionPanel.module.css'

/** The name the agents' CLIs register OXESpace's own MCP server under (electron/main agent-launch, thread-mcp). */
export const OXESPACE_MCP_SERVER = 'oxespace-delegation'

const MODE_INTENT: Record<McpToolGroupMode, 'success' | 'neutral' | 'warning'> = { always: 'success', 'on-demand': 'neutral', off: 'warning' }

/**
 * OXE-377: OXESpace's own tools in the session panel, under their product name rather than the server's technical one:
 * whether this session has them, each group this project can choose with its mode, and the way to Settings › Tools.
 */
export function ThreadIntegratedTools({ rootPath, servers }: { rootPath: string; servers?: ThreadMcpServerStatus[] }): ReactElement {
  const { t } = useTranslation('thread')
  const { t: ts } = useTranslation('settings')
  const [groups, setGroups] = useState<McpToolGroupInfo[] | null>(null)
  useEffect(() => {
    let live = true
    const read = window.oxe?.mcpInternal?.toolGroups
    if (!read || !rootPath) return
    read({ rootPath }).then(report => { if (live) setGroups(report.groups) }, () => { if (live) setGroups([]) })
    return () => { live = false }
  }, [rootPath])
  const server = servers?.find(item => item.name === OXESPACE_MCP_SERVER)
  const configurable = (groups ?? []).filter(group => (CONFIGURABLE_MCP_TOOL_GROUPS as readonly string[]).includes(group.id))
  return <section className={styles.integrated} aria-label={t('sessionPanel.tools.integrated')}>
    <h4 className={styles.subheading}>{t('sessionPanel.tools.integrated')}
      {server && <Badge intent={server.status === 'connected' ? 'success' : 'neutral'}>{server.status === 'connected' ? t('sessionPanel.tools.integratedOn') : t('sessionPanel.tools.integratedOff')}</Badge>}
    </h4>
    {configurable.length > 0 && <ul className={styles.list} aria-label={t('sessionPanel.tools.integratedGroups')}>
      {configurable.map(group => <li key={group.id}>
        <span className={styles.name}>{ts(`tools.groups.${group.id}.name` as 'tools.groups.data.name')}</span>
        <Badge intent={MODE_INTENT[group.mode]}>{ts(`tools.modes.${group.mode}` as 'tools.modes.off')}</Badge>
      </li>)}
    </ul>}
    <div className={styles.actions}><Button size="sm" variant="ghost" onClick={() => useUIStore.getState().openSettingsPage('mcp')}>{t('sessionPanel.tools.configure')}</Button></div>
  </section>
}
