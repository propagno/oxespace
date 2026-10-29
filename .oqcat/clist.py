PATH = 'src/components/OxeQuery/ConnectionList.tsx'
R = [
("import { toast } from '../../ui/Toast'\n", "import { exportConnections, importConnections } from './connection-transfer'\n"),
("onClick={() => void run(async () => {\n        const result = await oq('connections.import', {})\n        if (result.imported || result.skipped) toast({ title: t('connections.imported', { count: result.imported }), ...(result.skipped ? { description: t('connections.importSkipped', { count: result.skipped }), intent: 'warning' as const } : { intent: 'success' as const }) })\n      })}>",
 "onClick={() => void run(importConnections)}>"),
("onClick={() => void run(async () => { const result = await oq('connections.export', {}); if (result.saved) toast({ title: t('connections.exported', { count: result.count }), description: t('connections.exportNoSecrets'), intent: 'success' }) })}>",
 "onClick={() => void run(exportConnections)}>"),
]
