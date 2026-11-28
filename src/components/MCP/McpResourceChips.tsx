import { Database, X } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { McpResourceAttachment } from '../../../shared/types/mcp'
import { IconButton } from '../../ui'
import styles from '../Threads/PreviewElementChips.module.css'

export interface McpResourceChipsProps {
  resources: readonly McpResourceAttachment[]
  disabled?: boolean
  onRemove: (id: string) => void
}

/** Removable composer chips for attached MCP Resources (bounded & secret-redacted in main). */
export function McpResourceChips({ resources, disabled = false, onRemove }: McpResourceChipsProps): ReactElement | null {
  const { t } = useTranslation('thread')
  if (resources.length === 0) return null
  return (
    <div className={styles.list} role="list" aria-label={t('mcpPicker.attachedResources')} data-testid="mcp-resource-chips">
      {resources.map(item => (
        <span
          key={item.id}
          role="listitem"
          className={styles.chip}
          data-ui="mcp-resource-chip"
          data-testid="mcp-resource-chip"
          title={`${item.serverName}: ${item.uri}`}
        >
          <Database size={12} aria-hidden="true" className={styles.icon} />
          <span className={styles.label}>{item.name}</span>
          <code className={styles.selector}>{item.serverName}</code>
          <IconButton
            size="sm"
            variant="ghost"
            icon={<X size={12} aria-hidden="true" />}
            label={t('composer.remove', { name: item.name })}
            disabled={disabled}
            onClick={() => onRemove(item.id)}
          />
        </span>
      ))}
    </div>
  )
}
