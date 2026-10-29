PATH = 'src/components/OxeQuery/client.ts'
R = [
("import type { OxeQueryErrorInfo, OxeQueryOp, OxeQueryOps } from '../../../shared/types/oxequery'\n", "import type { OxeQueryErrorInfo, OxeQueryOp, OxeQueryOps } from '../../../shared/types/oxequery'\nimport { tq } from './catalog'\n"),
("message: 'OxeQuery is unavailable. Restart the updated application.' })", "message: tq('client.unavailable') })"),
("if (error instanceof OxeQueryClientError && error.hint) return `${error.message}\\nHint: ${error.hint}`\n  return error instanceof Error ? error.message : 'Something went wrong.'",
 "if (error instanceof OxeQueryClientError && error.hint) return `${error.message}\\n${tq('client.hint', { hint: error.hint })}`\n  return error instanceof Error ? error.message : tq('client.unknown')"),
]
