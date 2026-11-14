import { readFileSync } from 'node:fs'
const d = JSON.parse(readFileSync(process.argv[2], 'utf8'))
console.log('index.js total', d.total)
for (const k of ['electron/main/services/approvals/agent-permissions.ts', 'electron/main/services/browser-preview/preview-capture-store.ts', 'electron/main/mcp-internal/android-capture-advice.ts', 'electron/main/mcp-internal/tool-handlers.ts', 'shared/types/oxequery.ts', 'shared/types/agent-permissions.ts']) console.log(String(d.sizes[k] || 0).padStart(7), k)
