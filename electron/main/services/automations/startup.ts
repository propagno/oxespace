import type { AutomationService, AutomationServiceDeps } from './service'

type Modules = [typeof import('./service'), typeof import('./store')]

const loadModules = (): Promise<Modules> => Promise.all([import('./service'), import('./store')])

/**
 * Scheduled automations start after the first window, from their own chunk (T44): the service and its SQLite store
 * stay out of the main entry. Their own file keeps them independent of the application schema, so a store that
 * cannot open, or code that cannot load, only leaves this feature off: nothing registers and the result is undefined.
 */
export async function startAutomations(
  storePath: string,
  deps: Omit<AutomationServiceDeps, 'store'>,
  register: (service: AutomationService) => void,
  warn: (message: string, error: unknown) => void,
  load: () => Promise<Modules> = loadModules
): Promise<AutomationService | undefined> {
  try {
    const [{ AutomationService }, { AutomationStore }] = await load()
    const automations = new AutomationService({ ...deps, store: new AutomationStore(storePath) })
    register(automations)
    automations.start()
    return automations
  } catch (error) {
    warn('Automations unavailable', error)
    return undefined
  }
}
