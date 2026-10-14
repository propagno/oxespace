import type { PlanNode, SqlExplain } from '../../../shared/types/oxequery'

export type AskKind = 'explain' | 'fix' | 'plan' | 'write'

export interface AskContext {
  connectionName: string
  engine: 'postgres' | 'mongodb'
  environment: string
  sql?: string
  errorMessage?: string
  sqlState?: string
  explain?: SqlExplain | null
  /** What the person wants, for `write`. */
  request?: string
  /** `schema.table (col type, …)`: names and types only, never values. */
  tables?: string[]
}

const MAX_SQL = 6000
const MAX_PLAN = 3000
const clip = (text: string, max: number): string => text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters left out)` : text

function planLines(node: PlanNode, depth = 0, out: string[] = []): string[] {
  if (out.length >= 40) return out
  const rows = node.actualRows ?? node.planRows
  out.push(`${'  '.repeat(depth)}${node.nodeType}${node.relation ? ` on ${node.relation}` : ''} (cost ${node.totalCost ?? '?'}${rows !== undefined ? `, rows ${rows}` : ''}${node.actualMs !== undefined ? `, ${node.actualMs} ms` : ''})`)
  for (const child of node.children ?? []) planLines(child, depth + 1, out)
  return out
}

const HEADER = (context: AskContext): string =>
  `I am working in OxeQuery on the ${context.engine === 'postgres' ? 'PostgreSQL' : 'MongoDB'} connection "${context.connectionName}" (${context.environment}).`

const SAFETY = 'To look at the schema or run a read, use the oxespace_db_* tools: each request asks me for approval first, and data they return is masked. Do not ask me to paste credentials or rows with personal data. Do not change data unless I ask.'

/**
 * The prompt pasted into the agent terminal. It carries the statement, the error or the plan and the
 * names of tables and columns: never rows. The person reads it and presses Enter to send it.
 */
export function buildAgentPrompt(kind: AskKind, context: AskContext): string {
  const parts: string[] = [HEADER(context)]
  const language = context.engine === 'postgres' ? 'sql' : 'js'
  if (kind === 'explain') parts.push('Explain what this statement does, step by step, and point out anything risky or slow.')
  if (kind === 'fix') parts.push(`This statement failed${context.sqlState ? ` (SQLSTATE ${context.sqlState})` : ''}. Say why and give a corrected version.`)
  if (kind === 'plan') parts.push('Read this query plan. What is slow, and what index or rewrite would help? Show the change as SQL I can review.')
  if (kind === 'write') parts.push(`Write a ${context.engine === 'postgres' ? 'SQL' : 'MongoDB'} query for this: ${(context.request ?? '').trim() || '(describe what you need)'}`)
  if (context.sql?.trim()) parts.push(`Statement:\n\`\`\`${language}\n${clip(context.sql.trim(), MAX_SQL)}\n\`\`\``)
  if (kind === 'fix' && context.errorMessage) parts.push(`Error:\n${clip(context.errorMessage, 1500)}`)
  if (kind === 'plan' && context.explain) parts.push(`Plan (${context.explain.analyze ? 'with timings' : 'estimates only'}):\n\`\`\`\n${clip(planLines(context.explain.plan).join('\n'), MAX_PLAN)}\n\`\`\``)
  if (context.tables?.length) parts.push(`Tables I am looking at (names and types only):\n${context.tables.slice(0, 20).map(table => `- ${table}`).join('\n')}`)
  parts.push(SAFETY)
  return parts.join('\n\n')
}

/** `public.users (id integer, email text)` for the table a person has open. */
export function describeTable(schema: string, table: string, columns: { name: string; type: string }[]): string {
  return `${schema}.${table} (${columns.slice(0, 40).map(column => `${column.name} ${column.type}`).join(', ')})`
}
