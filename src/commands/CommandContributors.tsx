/**
 * T52 · The command palette's and the menu bar's contributions, loaded after the first frame: both surfaces are lazy, and
 * keyboard shortcuts never go through these lists (App and each view call useKeybindings themselves). The settings and
 * activity commands register on import, so importing this module registers them too.
 */
import './settings.commands'
import './activity.commands'
import { useCodeCommands, type CodeCommandContext } from './code.commands'
import { useThreadCommands, type ThreadCommandContext } from './thread.commands'

/** Calls useCodeCommands with App's context; renders nothing. */
export function CodeCommandContributor(context: CodeCommandContext): null {
  useCodeCommands(context)
  return null
}

/** Calls useThreadCommands with App's context; renders nothing. */
export function ThreadCommandContributor(context: ThreadCommandContext): null {
  useThreadCommands(context)
  return null
}
