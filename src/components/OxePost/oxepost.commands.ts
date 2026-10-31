import { FilePlus2, Globe, KeyRound, Search, Upload } from 'lucide-react'
import { i18n } from '../../i18n'
import { registerCommands, type ContributedCommand } from '../../utils/commandRegistry'
import { requestOxePostAction, type OxePostAction } from './oxepost-bridge'

/**
 * The OxePost entries of the command palette. App.tsx loads this right after the first paint; the view stays lazy.
 * Their labels live in the `common` catalog (loaded at boot), so the palette is in the right language before
 * OxePost's own catalog is fetched.
 */
const ENTRIES: Array<{ action: OxePostAction; icon: typeof Globe; keywords: string[]; detail?: boolean }> = [
  { action: 'open', icon: Globe, detail: true, keywords: ['api', 'http', 'rest', 'postman', 'curl', 'request'] },
  { action: 'newRequest', icon: FilePlus2, detail: true, keywords: ['api', 'http', 'request', 'endpoint'] },
  { action: 'filter', icon: Search, keywords: ['api', 'request', 'find'] },
  { action: 'import', icon: Upload, detail: true, keywords: ['curl', 'openapi', 'swagger', 'import'] },
  { action: 'environments', icon: KeyRound, detail: true, keywords: ['environment', 'variables', 'secrets', 'staging', 'production'] }
]

export function oxePostCommands(): ContributedCommand[] {
  return ENTRIES.map(({ action, icon, keywords, detail }) => ({
    id: `oxepost.${action}`, category: 'OxePost', icon, keywords, run: () => requestOxePostAction(action),
    label: i18n.t(`postCommands.${action}.label`), ...(detail ? { detail: i18n.t(`postCommands.${action}.detail` as 'postCommands.open.detail') } : {})
  }))
}

registerCommands('oxepost', oxePostCommands())
i18n.on('languageChanged', () => registerCommands('oxepost', oxePostCommands()))
