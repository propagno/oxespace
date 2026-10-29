PATH = 'src/components/OxeQuery/OxeQuerySidebar.tsx'
R = [
("import { Suspense, lazy, useEffect, useState, type ReactElement } from 'react'", "import { Suspense, lazy, useEffect, type ReactElement } from 'react'"),
("  const [settings, setSettings] = useState(false)\n", "  const settings = useOxeQueryStore(state => state.preferencesOpen)\n  const setSettings = useOxeQueryStore(state => state.setPreferencesOpen)\n"),
]
