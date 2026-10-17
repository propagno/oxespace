import { Boxes, Database, FileDown, FileUp, Play, Plus, Search, Settings, Table2, TextCursorInput } from 'lucide-react'
import { registerCommands } from '../../utils/commandRegistry'
import { requestOxeQueryAction, type OxeQueryAction } from './oxequery-bridge'

const CATEGORY = 'OxeQuery'
const command = (id: string, label: string, action: OxeQueryAction, extra: { detail?: string; icon?: typeof Database; keywords?: string[] } = {}) =>
  ({ id: `oxequery.${id}`, label, category: CATEGORY, run: () => requestOxeQueryAction(action), ...extra })

/** The OxeQuery entries of the command palette. Loaded at boot; the view itself stays lazy. */
registerCommands('oxequery', [
  command('open', 'Open OxeQuery', 'open', { icon: Database, detail: 'Containers and databases', keywords: ['database', 'sql', 'postgres', 'mongo'] }),
  command('newConnection', 'New database connection', 'newConnection', { icon: Plus, keywords: ['connect', 'postgres', 'mongodb'] }),
  command('newQuery', 'New query tab', 'newQuery', { icon: TextCursorInput, keywords: ['sql', 'editor'] }),
  command('runAll', 'Run all statements', 'runAll', { icon: Play, keywords: ['execute', 'script'] }),
  command('searchObjects', 'Search database objects', 'searchObjects', { icon: Search, keywords: ['table', 'schema', 'collection'] }),
  command('newTable', 'New table', 'newTable', { icon: Table2, keywords: ['create', 'structure'] }),
  command('settings', 'OxeQuery settings', 'settings', { icon: Settings, keywords: ['history', 'audit', 'agents'] }),
  command('importConnections', 'Import connections', 'importConnections', { icon: FileUp }),
  command('exportConnections', 'Export connections', 'exportConnections', { icon: FileDown, detail: 'Without passwords' }),
  command('compose', 'Compose projects', 'compose', { icon: Boxes, keywords: ['docker', 'containers'] })
])
