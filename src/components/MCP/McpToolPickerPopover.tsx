import { ChevronDown, ChevronRight, Database, Paperclip, Plug, ShieldAlert, ShieldCheck, ShieldQuestion, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { serverKey, type McpResourceAttachment, type McpResourceDescriptor, type McpServer } from '../../../shared/types/mcp'
import type { ThreadSnapshot } from '../../../shared/types/thread'
import { selectMcpServers, useMcpStore } from '../../store/mcp.store'
import { useMcpPickerStore } from '../../store/mcp-picker.store'
import { useThreadStore } from '../../store/thread.store'
import { useUIStore } from '../../store/ui.store'
import { Button, Checkbox, EmptyState, IconButton, Popover, Spinner, Switch, TextField } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'
import { isQuarantined } from './mcpQuarantine'
import styles from './McpToolPickerPopover.module.css'

export type McpPickerTab = 'tools' | 'resources'

export interface McpToolPickerPopoverProps {
  workspaceId: string | null
  threadId: string | null
  snapshot?: ThreadSnapshot | null
  open: boolean
  initialTab?: McpPickerTab
  onOpenChange: (open: boolean) => void
  onAttachResource?: (attachment: McpResourceAttachment) => void
  onError?: (message: string) => void
  trigger: ReactNode
}

const NO_DISABLED: string[] = []

function serverKeyOf(server: McpServer): string {
  return server.key || serverKey(server.name)
}

/** Computes enabled/total tool count for one server under a conversation's disabled patterns. */
export function countServerEnabledTools(server: McpServer, disabledPatterns: readonly string[]): { enabled: number; total: number; serverDisabled: boolean } {
  const sKey = serverKeyOf(server)
  const total = server.tools.length
  if (!server.enabled || !server.trusted || isQuarantined(server)) {
    return { enabled: 0, total, serverDisabled: true }
  }
  const set = new Set(disabledPatterns)
  const wholeDisabled = set.has(`${sKey}/*`)
  if (wholeDisabled) return { enabled: 0, total, serverDisabled: true }
  if (total === 0) return { enabled: 0, total: 0, serverDisabled: false }
  const enabled = server.tools.filter(tool => !set.has(`${sKey}/${tool.name}`)).length
  return { enabled, total, serverDisabled: enabled === 0 && total > 0 }
}

/**
 * Silent, obsidian-minimal popover for per-server / per-conversation MCP tool selection
 * (preserving MCP Pinning & Quarantine badges) and MCP Resource discovery/attachment.
 */
export function McpToolPickerPopover({
  workspaceId,
  threadId,
  snapshot,
  open,
  initialTab = 'tools',
  onOpenChange,
  onAttachResource,
  onError,
  trigger
}: McpToolPickerPopoverProps): ReactElement {
  const { t } = useTranslation('thread')
  const [tabOverride, setTabOverride] = useState<McpPickerTab | null>(null)
  const tab: McpPickerTab = tabOverride ?? initialTab
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [loadingResources, setLoadingResources] = useState<Record<string, boolean>>({})
  const [attachingUri, setAttachingUri] = useState<string | null>(null)
  const requestedResourcesRef = useRef<Set<string>>(new Set())

  const handleOpenChange = useCallback((nextOpen: boolean): void => {
    if (!nextOpen) {
      setTabOverride(null)
      requestedResourcesRef.current.clear()
    }
    onOpenChange(nextOpen)
  }, [onOpenChange])

  const serversSelector = useMemo(() => selectMcpServers(workspaceId), [workspaceId])
  const allServers = useMcpStore(serversSelector)
  const loadServers = useMcpStore(state => state.load)
  const listResources = useMcpPickerStore(state => state.listResources)
  const readResource = useMcpPickerStore(state => state.readResource)
  const resourcesByServer = useMcpPickerStore(state => state.resourcesByServer)
  const storeDisabled = useMcpPickerStore(state => threadId ? (state.disabledToolsByThread[threadId] ?? NO_DISABLED) : NO_DISABLED)
  const setThreadDisabledTools = useMcpPickerStore(state => state.setThreadDisabledTools)

  // Hydrate conversation's saved disabledMcpTools from thread snapshot when present
  const snapshotDisabled = snapshot?.thread.pendingConfiguration?.disabledMcpTools ?? snapshot?.thread.disabledMcpTools
  useEffect(() => {
    if (threadId && Array.isArray(snapshotDisabled) && storeDisabled.length === 0 && snapshotDisabled.length > 0) {
      setThreadDisabledTools(threadId, snapshotDisabled)
    }
  }, [threadId, snapshotDisabled, storeDisabled.length, setThreadDisabledTools])

  useEffect(() => {
    if (open && allServers.length === 0) {
      void loadServers(workspaceId)
    }
  }, [open, allServers.length, loadServers, workspaceId])

  const servers = useMemo(
    () => allServers.filter(server => !(server.workspaceId === null && server.name === 'oxespace')),
    [allServers]
  )

  const disabledPatterns = storeDisabled
  const disabledSet = useMemo(() => new Set(disabledPatterns), [disabledPatterns])

  const commitDisabled = useCallback(async (next: string[]): Promise<void> => {
    if (!threadId) return
    const unique = [...new Set(next)]
    setThreadDisabledTools(threadId, unique)
    if (snapshot && window.oxe?.thread?.configure) {
      try {
        const updated = await window.oxe.thread.configure(
          threadId,
          { disabledMcpTools: unique },
          snapshot.thread.configurationRevision ?? 0
        )
        useThreadStore.getState().updateSnapshot(updated)
      } catch (err) {
        onError?.(humanizeError(err, t('mcpPicker.saveFailed')))
      }
    }
  }, [threadId, setThreadDisabledTools, snapshot, onError, t])

  const toggleServer = useCallback((server: McpServer, enable: boolean): void => {
    const sKey = serverKeyOf(server)
    const filtered = disabledPatterns.filter(item => item !== `${sKey}/*` && !item.startsWith(`${sKey}/`))
    const next = enable ? filtered : [...filtered, `${sKey}/*`]
    void commitDisabled(next)
  }, [disabledPatterns, commitDisabled])

  const toggleTool = useCallback((server: McpServer, toolName: string, enable: boolean): void => {
    const sKey = serverKeyOf(server)
    const pattern = `${sKey}/${toolName}`
    if (enable) {
      if (disabledSet.has(`${sKey}/*`)) {
        // Switching from whole-server disabled to only this tool enabled
        const rest = disabledPatterns.filter(item => item !== `${sKey}/*`)
        const othersDisabled = server.tools.filter(tool => tool.name !== toolName).map(tool => `${sKey}/${tool.name}`)
        void commitDisabled([...rest, ...othersDisabled])
        return
      }
      void commitDisabled(disabledPatterns.filter(item => item !== pattern))
    } else {
      void commitDisabled([...disabledPatterns, pattern])
    }
  }, [disabledPatterns, disabledSet, commitDisabled])

  const needle = query.trim().toLowerCase()
  const filteredServers = useMemo(() => {
    if (!needle) return servers
    return servers.filter(server =>
      server.name.toLowerCase().includes(needle)
      || server.tools.some(tool => tool.name.toLowerCase().includes(needle) || tool.description.toLowerCase().includes(needle))
    )
  }, [servers, needle])

  const totals = useMemo(() => {
    let enabledCount = 0
    let totalCount = 0
    for (const server of servers) {
      const counts = countServerEnabledTools(server, disabledPatterns)
      enabledCount += counts.enabled
      totalCount += counts.total
    }
    return { enabled: enabledCount, total: totalCount }
  }, [servers, disabledPatterns])

  const loadServerResources = useCallback(async (server: McpServer): Promise<void> => {
    if (!server.trusted || isQuarantined(server)) return
    setLoadingResources(prev => ({ ...prev, [server.id]: true }))
    try {
      await listResources(server.id)
    } catch (err) {
      onError?.(humanizeError(err, t('mcpPicker.resourcesFailed')))
    } finally {
      setLoadingResources(prev => ({ ...prev, [server.id]: false }))
    }
  }, [listResources, onError, t])

  useEffect(() => {
    if (!open || tab !== 'resources') return
    let cancelled = false
    for (const server of servers) {
      if (!server.enabled || !server.trusted || isQuarantined(server)) continue
      if (server.id in resourcesByServer || requestedResourcesRef.current.has(server.id)) continue
      requestedResourcesRef.current.add(server.id)
      void Promise.resolve().then(async () => {
        if (cancelled) return
        await loadServerResources(server)
      })
    }
    return () => { cancelled = true }
  }, [open, tab, servers, resourcesByServer, loadServerResources])

  const handleAttachResource = useCallback(async (server: McpServer, resource: McpResourceDescriptor): Promise<void> => {
    setAttachingUri(`${server.id}:${resource.uri}`)
    try {
      const result = await readResource(server.id, resource.uri)
      const textParts = result.contents.map(item =>
        item.text ?? (item.blobBytes !== undefined ? `[binary resource: ${item.blobBytes} bytes]` : '')
      ).filter(Boolean)
      const text = textParts.join('\n\n')
      const truncated = result.contents.some(item => item.truncated)
      const attachment: McpResourceAttachment = {
        id: `${server.id}:${resource.uri}`,
        serverId: server.id,
        serverName: server.name,
        uri: resource.uri,
        name: resource.name,
        mimeType: resource.mimeType ?? result.contents[0]?.mimeType,
        text,
        bytes: new TextEncoder().encode(text).length,
        ...(truncated ? { truncated: true } : {})
      }
      if (onAttachResource) {
        onAttachResource(attachment)
      } else if (threadId) {
        useMcpPickerStore.getState().addMcpResource(threadId, attachment)
      }
      onOpenChange(false)
    } catch (err) {
      onError?.(humanizeError(err, t('mcpPicker.attachFailed')))
    } finally {
      setAttachingUri(null)
    }
  }, [readResource, onAttachResource, threadId, onOpenChange, onError, t])

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      side="top"
      align="start"
      label={t('mcpPicker.label')}
      className={styles.panel}
      trigger={trigger}
    >
      <header className={styles.header}>
        <div className={styles.tabs} role="group" aria-label={t('mcpPicker.label')}>
          <Button
            variant="ghost"
            size="sm"
            className={styles.tabButton}
            aria-pressed={tab === 'tools'}
            data-testid="mcp-picker-tab-tools"
            icon={<Wrench size={12} aria-hidden="true" />}
            onClick={() => setTabOverride('tools')}
          >
            {t('mcpPicker.toolsTab')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={styles.tabButton}
            aria-pressed={tab === 'resources'}
            data-testid="mcp-picker-tab-resources"
            icon={<Database size={12} aria-hidden="true" />}
            onClick={() => setTabOverride('resources')}
          >
            {t('mcpPicker.resourcesTab')}
          </Button>
        </div>
        {tab === 'tools' && (
          <span className={styles.counter} data-testid="mcp-picker-total-counter">
            {t('mcpPicker.enabledCount', { enabled: totals.enabled, total: totals.total })}
          </span>
        )}
      </header>

      <div className={styles.searchWrap}>
        <TextField
          type="search"
          aria-label={t('mcpPicker.searchLabel')}
          placeholder={tab === 'tools' ? t('mcpPicker.searchTools') : t('mcpPicker.searchResources')}
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
      </div>

      <div className={styles.list} data-testid="mcp-picker-list">
        {tab === 'tools' ? (
          filteredServers.length === 0 ? (
            <EmptyState compact icon={<Plug size={16} />} title={query ? t('mcpPicker.noMatch') : t('mcpPicker.noServers')}>
              {query ? t('mcpPicker.noMatchHint') : t('mcpPicker.noServersHint')}
            </EmptyState>
          ) : (
            filteredServers.map(server => {
              const quarantined = isQuarantined(server)
              const trust: 'trusted' | 'quarantined' | 'untrusted' = quarantined ? 'quarantined' : server.trusted ? 'trusted' : 'untrusted'
              const counts = countServerEnabledTools(server, disabledPatterns)
              const sKey = serverKeyOf(server)
              const isExpanded = Boolean(expanded[server.id] || (needle.length > 0 && server.tools.length > 0))
              const visibleTools = needle
                ? server.tools.filter(tool => tool.name.toLowerCase().includes(needle) || tool.description.toLowerCase().includes(needle) || server.name.toLowerCase().includes(needle))
                : server.tools
              const wholeDisabled = disabledSet.has(`${sKey}/*`)
              const locked = !server.enabled || !server.trusted || quarantined

              return (
                <div key={server.id} className={styles.serverGroup} data-testid={`mcp-picker-server-${sKey}`}>
                  <div className={styles.serverHeader}>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={isExpanded ? t('mcpPicker.collapseServer', { name: server.name }) : t('mcpPicker.expandServer', { name: server.name })}
                      aria-expanded={isExpanded}
                      disabled={server.tools.length === 0}
                      icon={isExpanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
                      onClick={() => setExpanded(prev => ({ ...prev, [server.id]: !prev[server.id] }))}
                    />
                    <div className={styles.serverMain}>
                      <span className={styles.serverName}>{server.name}</span>
                      <span className={styles.transportTag}>{server.transport}</span>
                      <span
                        className={styles.trustBadge}
                        data-trust={trust}
                        data-testid={`mcp-picker-trust-${sKey}`}
                        title={trust === 'quarantined' ? t('mcpPicker.trustQuarantined') : trust === 'trusted' ? t('mcpPicker.trustPinned') : t('mcpPicker.trustReview')}
                      >
                        {trust === 'quarantined' ? <ShieldAlert size={12} aria-hidden="true" /> : trust === 'trusted' ? <ShieldCheck size={12} aria-hidden="true" /> : <ShieldQuestion size={12} aria-hidden="true" />}
                        {trust === 'quarantined' ? t('mcpPicker.quarantined') : trust === 'trusted' ? t('mcpPicker.pinned') : t('mcpPicker.untrusted')}
                      </span>
                    </div>
                    <span className={styles.counter} data-testid={`mcp-picker-count-${sKey}`}>
                      {t('mcpPicker.enabledCount', { enabled: counts.enabled, total: counts.total })}
                    </span>
                    <Switch
                      checked={!locked && !wholeDisabled && (counts.total === 0 || counts.enabled > 0)}
                      disabled={locked}
                      ariaLabel={t('mcpPicker.toggleServer', { name: server.name })}
                      onChange={checked => toggleServer(server, checked)}
                    />
                  </div>

                  {quarantined && (
                    <div className={styles.quarantineBanner} role="status" data-testid={`mcp-picker-quarantine-warning-${sKey}`}>
                      <span>{t('mcpPicker.quarantineLocked')}</span>
                      <Button variant="ghost" size="sm" onClick={() => { onOpenChange(false); useUIStore.getState().openMcpPanel() }}>
                        {t('mcpPicker.reviewServer')}
                      </Button>
                    </div>
                  )}

                  {isExpanded && visibleTools.length > 0 && !quarantined && (
                    <div className={styles.toolList} data-testid={`mcp-picker-tools-${sKey}`}>
                      {visibleTools.map(tool => {
                        const toolEnabled = !locked && !wholeDisabled && !disabledSet.has(`${sKey}/${tool.name}`)
                        return (
                          <div key={tool.name} className={styles.toolRow}>
                            <Checkbox
                              checked={toolEnabled}
                              disabled={locked}
                              aria-label={tool.name}
                              onChange={event => toggleTool(server, tool.name, event.currentTarget.checked)}
                              label={
                                <span className={styles.toolLabel}>
                                  <span className={styles.toolName}>{tool.name}</span>
                                  {tool.description ? <span className={styles.toolDesc}>{tool.description}</span> : null}
                                </span>
                              }
                            />
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          )
        ) : (
          servers.filter(server => server.enabled && server.trusted && !isQuarantined(server)).length === 0 ? (
            <EmptyState compact icon={<Database size={16} />} title={t('mcpPicker.noResourceServers')}>
              {t('mcpPicker.noResourceServersHint')}
            </EmptyState>
          ) : (
            servers
              .filter(server => server.enabled && server.trusted && !isQuarantined(server))
              .map(server => {
                const rawResources = resourcesByServer[server.id] ?? []
                const visibleResources = needle
                  ? rawResources.filter(item => item.name.toLowerCase().includes(needle) || item.uri.toLowerCase().includes(needle) || (item.description ?? '').toLowerCase().includes(needle))
                  : rawResources
                const busyLoading = Boolean(loadingResources[server.id])
                return (
                  <div key={server.id} className={styles.serverGroup} data-testid={`mcp-resources-server-${serverKeyOf(server)}`}>
                    <div className={styles.serverHeader}>
                      <div className={styles.serverMain}>
                        <span className={styles.serverName}>{server.name}</span>
                        <span className={styles.transportTag}>{server.transport}</span>
                      </div>
                      {busyLoading ? <Spinner size="sm" decorative /> : (
                        <Button variant="ghost" size="sm" onClick={() => void loadServerResources(server)}>
                          {t('mcpPicker.refreshResources')}
                        </Button>
                      )}
                    </div>
                    {visibleResources.length === 0 ? (
                      <div className={styles.emptyHint}>
                        {busyLoading ? t('mcpPicker.loadingResources') : t('mcpPicker.noResources')}
                      </div>
                    ) : (
                      visibleResources.map(resource => {
                        const keyId = `${server.id}:${resource.uri}`
                        return (
                          <div key={resource.uri} className={styles.resourceRow} data-testid="mcp-resource-row">
                            <div className={styles.resourceInfo}>
                              <span className={styles.toolName}>{resource.name}</span>
                              <span className={styles.resourceUri} title={resource.uri}>{resource.uri}</span>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={attachingUri === keyId}
                              data-testid={`mcp-attach-resource-${resource.name}`}
                              icon={<Paperclip size={12} aria-hidden="true" />}
                              onClick={() => void handleAttachResource(server, resource)}
                            >
                              {attachingUri === keyId ? t('mcpPicker.attaching') : t('mcpPicker.attachResource')}
                            </Button>
                          </div>
                        )
                      })
                    )}
                  </div>
                )
              })
          )
        )}
      </div>

      <footer className={styles.footer}>
        <Button variant="ghost" size="sm" icon={<Plug size={12} aria-hidden="true" />} onClick={() => { onOpenChange(false); useUIStore.getState().openMcpPanel() }}>
          {t('mcpPicker.manageServers')}
        </Button>
      </footer>
    </Popover>
  )
}
