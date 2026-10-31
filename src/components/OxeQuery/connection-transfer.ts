import { oq } from './client'
import { tq } from './catalog'
import { useOxeQueryStore } from './oxequery.store'
import { toast } from '../../ui/Toast'

/** Imports connections from a file the person picks; says what came in and what was skipped. Throws on failure. */
export async function importConnections(): Promise<void> {
  const result = await oq('connections.import', {})
  if (result.imported || result.skipped) {
    toast({ title: tq('connections.imported', { count: result.imported }), ...(result.skipped ? { description: tq('connections.importSkipped', { count: result.skipped }), intent: 'warning' as const } : { intent: 'success' as const }) })
  }
  await useOxeQueryStore.getState().refreshConnections()
}

/** Exports the saved connections, without passwords or keys, to a file the person picks. Throws on failure. */
export async function exportConnections(): Promise<void> {
  if (useOxeQueryStore.getState().connections.length === 0) { toast({ title: tq('palette.nothingYet'), description: tq('connections.nothingToExport'), intent: 'info' }); return }
  const result = await oq('connections.export', {})
  if (result.saved) toast({ title: tq('connections.exported', { count: result.count }), description: tq('connections.exportNoSecrets'), intent: 'success' })
}
