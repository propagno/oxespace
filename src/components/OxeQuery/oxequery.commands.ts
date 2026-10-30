import { Boxes, Database, FileDown, FileUp, Play, Plus, Search, Settings, Table2, TextCursorInput } from 'lucide-react'
import { i18n } from '../../i18n'
import { registerCommands, type ContributedCommand } from '../../utils/commandRegistry'
import { requestOxeQueryAction, type OxeQueryAction } from './oxequery-bridge'

/**
 * The OxeQuery entries of the command palette. App.tsx loads this right after the first paint; the view stays lazy.
 * Their labels live in the `common` catalog (already loaded at boot), so the palette is in the right language before
 * OxeQuery's own catalog is ever fetched.
 */
const ENTRIES: Array<{ action: Exclude<OxeQueryAction, 'open'> | 'open'; icon: typeof Database; keywords?: string[]; detail?: boolean }> = [
  { action: 'open', icon: Database, detail: true, keywords: ['database', 'sql', 'postgres', 'mongo'] },
  { action: 'newConnection', icon: Plus, keywords: ['connect', 'postgres', 'mongodb'] },
  { action: 'newQuery', icon: TextCursorInput, keywords: ['sql', 'editor'] },
  { action: 'runAll', icon: Play, keywords: ['execute', 'script'] },
  { action: 'searchObjects', icon: Search, keywords: ['table', 'schema', 'collection'] },
  { action: 'newTable', icon: Table2, keywords: ['create', 'structure'] },
  { action: 'settings', icon: Settings, keywords: ['history', 'audit', 'agents'] },
  { action: 'importConnections', icon: FileUp },
  { action: 'exportConnections', icon: FileDown, detail: true },
  { action: 'compose', icon: Boxes, keywords: ['docker', 'containers', 'compose'] }
]

export function oxeQueryCommands(): ContributedCommand[] {
  const category = 'OxeQuery'
  return ENTRIES.map(({ action, icon, keywords, detail }) => ({
    id: `oxequery.${action}`, category, icon, run: () => requestOxeQueryAction(action),
    label: i18n.t(`oxequeryCommands.${action}.label`), ...(detail ? { detail: i18n.t(`oxequeryCommands.${action}.detail` as 'oxequeryCommands.open.detail') } : {}),
    ...(keywords ? { keywords } : {})
  }))
}

registerCommands('oxequery', oxeQueryCommands())
i18n.on('languageChanged', () => registerCommands('oxequery', oxeQueryCommands()))
