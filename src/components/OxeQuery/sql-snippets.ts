import type { Monaco } from '@monaco-editor/react'

interface TextModel { getWordUntilPosition(position: { lineNumber: number; column: number }): { startColumn: number; endColumn: number }; getValue(): string; getFullModelRange(): object }

/** Templates offered while typing; `$1`, `${2:name}` are tab stops (Monaco snippet syntax). */
export interface SqlSnippet { label: string; detail: string; body: string }

export const SQL_SNIPPETS: SqlSnippet[] = [
  { label: 'sel', detail: 'SELECT … FROM … WHERE', body: 'SELECT ${1:*}\nFROM ${2:table}\nWHERE ${3:condition}\nLIMIT ${4:100};' },
  { label: 'selc', detail: 'SELECT count(*)', body: 'SELECT count(*)\nFROM ${1:table}\nWHERE ${2:true};' },
  { label: 'seld', detail: 'SELECT with GROUP BY', body: 'SELECT ${1:column}, count(*) AS n\nFROM ${2:table}\nGROUP BY ${1:column}\nORDER BY n DESC;' },
  { label: 'join', detail: 'JOIN two tables', body: 'SELECT a.*, b.*\nFROM ${1:table_a} a\nJOIN ${2:table_b} b ON b.${3:a_id} = a.${4:id}\nWHERE ${5:true};' },
  { label: 'cte', detail: 'WITH (common table expression)', body: 'WITH ${1:name} AS (\n  SELECT ${2:*}\n  FROM ${3:table}\n)\nSELECT * FROM ${1:name};' },
  { label: 'ins', detail: 'INSERT INTO … VALUES', body: 'INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values});' },
  { label: 'upd', detail: 'UPDATE … SET … WHERE', body: 'UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${4:condition};' },
  { label: 'del', detail: 'DELETE FROM … WHERE', body: 'DELETE FROM ${1:table}\nWHERE ${2:condition};' },
  { label: 'upsert', detail: 'INSERT … ON CONFLICT DO UPDATE', body: 'INSERT INTO ${1:table} (${2:id}, ${3:column})\nVALUES (${4:1}, ${5:value})\nON CONFLICT (${2:id}) DO UPDATE SET ${3:column} = EXCLUDED.${3:column};' },
  { label: 'crt', detail: 'CREATE TABLE', body: 'CREATE TABLE ${1:name} (\n  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n  ${2:column} ${3:text} NOT NULL,\n  created_at timestamptz NOT NULL DEFAULT now()\n);' },
  { label: 'idx', detail: 'CREATE INDEX', body: 'CREATE INDEX ${1:name} ON ${2:table} (${3:column});' },
  { label: 'alt', detail: 'ALTER TABLE ADD COLUMN', body: 'ALTER TABLE ${1:table}\n  ADD COLUMN ${2:column} ${3:text};' },
  { label: 'expl', detail: 'EXPLAIN ANALYZE', body: 'EXPLAIN (ANALYZE, BUFFERS)\n${1:SELECT 1};' },
  { label: 'size', detail: 'Largest tables', body: "SELECT relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS size\nFROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace\nWHERE n.nspname = '${1:public}' AND c.relkind = 'r'\nORDER BY pg_total_relation_size(c.oid) DESC\nLIMIT 20;" },
  { label: 'locks', detail: 'Waiting sessions', body: "SELECT pid, state, wait_event_type, wait_event, now() - query_start AS running, left(query, 120) AS query\nFROM pg_stat_activity\nWHERE state <> 'idle'\nORDER BY query_start;" }
]

let registered = false

/** Registers the snippets and a document formatter once for the SQL language. */
export function registerSqlExtras(monaco: Monaco): void {
  if (registered) return
  registered = true
  monaco.languages.registerCompletionItemProvider('sql', {
    provideCompletionItems(model: TextModel, position: { lineNumber: number; column: number }) {
      const word = model.getWordUntilPosition(position)
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
      return {
        suggestions: SQL_SNIPPETS.map(snippet => ({
          label: snippet.label, kind: monaco.languages.CompletionItemKind.Snippet, detail: snippet.detail, documentation: { value: `\`\`\`sql\n${snippet.body.replace(/\$\{\d+:([^}]*)\}|\$\d+/g, '$1')}\n\`\`\`` },
          insertText: snippet.body, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range, sortText: `9${snippet.label}`
        }))
      }
    }
  })
  monaco.languages.registerDocumentFormattingEditProvider('sql', {
    async provideDocumentFormattingEdits(model: TextModel) {
      const formatted = await formatSql(model.getValue())
      return [{ range: model.getFullModelRange(), text: formatted }]
    }
  })
}

/** Formats PostgreSQL text; loaded on first use so the formatter stays out of the initial chunk. */
export async function formatSql(sql: string): Promise<string> {
  const { format } = await import('sql-formatter')
  try { return format(sql, { language: 'postgresql', keywordCase: 'upper', tabWidth: 2, linesBetweenQueries: 1 }) } catch { return sql }
}
