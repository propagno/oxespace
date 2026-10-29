PATH = 'src/components/OxeQuery/oxequery-bridge.ts'
R = [
("type ControlAction = 'newQuery' | 'runAll' | 'searchObjects' | 'newTable' | 'compose'\nconst CONTROL_ACTIONS = new Set<OxeQueryAction>(['newQuery', 'runAll', 'searchObjects', 'newTable', 'compose'])",
 "type ControlAction = 'newQuery' | 'runAll' | 'searchObjects' | 'newTable'\nconst CONTROL_ACTIONS = new Set<OxeQueryAction>(['newQuery', 'runAll', 'searchObjects', 'newTable'])"),
("  if (action === 'settings') { store.setPreferencesOpen(true); return }\n", "  if (action === 'settings') { store.setPreferencesOpen(true); return }\n  // Compose projects are chosen on the Containers tab (moving to OxePod as it is).\n  if (action === 'compose') { store.setActiveTab('containers'); return }\n"),
("    // Compose projects live on the Containers tab: bring it to the front first.\n    if (control === 'compose') (await import('./oxequery.store')).useOxeQueryStore.getState().setActiveTab('containers')\n", ""),
("if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) target.focus()", "if (target instanceof HTMLInputElement) target.focus()"),
]
