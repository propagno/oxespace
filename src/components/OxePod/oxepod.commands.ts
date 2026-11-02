import { Boxes, Eraser, HardDrive, Search, ShieldCheck } from 'lucide-react'
import { commandText } from '../../commands/commandText'
import { i18n } from '../../i18n'
import { registerCommands, type ContributedCommand } from '../../utils/commandRegistry'
import { requestOxePodAction, type OxePodAction } from './oxepod-bridge'

/**
 * The OxePod entries of the command palette. App.tsx loads this right after the first paint; the view stays lazy.
 * Their labels live in the `common` catalog (loaded at boot), so the palette is in the right language before OxePod's
 * own catalog is fetched.
 */
const ENTRIES: Array<{ action: OxePodAction; icon: typeof Boxes; keywords: string[]; detail?: boolean }> = [
  { action: 'open', icon: Boxes, detail: true, keywords: ['docker', 'podman', 'containers', 'compose'] },
  { action: 'filter', icon: Search, keywords: ['docker', 'containers', 'find'] },
  { action: 'resources', icon: HardDrive, keywords: ['images', 'volumes', 'networks', 'disk'] },
  { action: 'activity', icon: ShieldCheck, keywords: ['agents', 'audit', 'containers'] },
  { action: 'pruneContainers', icon: Eraser, detail: true, keywords: ['prune', 'clean', 'stopped', 'docker'] }
]

export function oxePodCommands(): ContributedCommand[] {
  return ENTRIES.map(({ action, icon, keywords, detail }) => ({
    id: `oxepod.${action}`, icon, run: () => requestOxePodAction(action),
    ...commandText('OxePod', `oxepod.${action}`, { keywords }), ...(detail ? { detail: i18n.t(`podsCommands.${action}.detail` as 'podsCommands.open.detail') } : {})
  }))
}

registerCommands('oxepod', oxePodCommands())
i18n.on('languageChanged', () => registerCommands('oxepod', oxePodCommands()))
