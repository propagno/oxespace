import re
PATH = 'src/components/OxeQuery/sql-snippets.ts'
R = [
("import type { Monaco } from '@monaco-editor/react'\n", "import type { Monaco } from '@monaco-editor/react'\nimport { tq } from './catalog'\n"),
("/** Templates offered while typing; `$1`, `${2:name}` are tab stops (Monaco snippet syntax). */\nexport interface SqlSnippet { label: string; detail: string; body: string }",
 "/**\n * Templates offered while typing; `$1`, `${2:name}` are tab stops (Monaco snippet syntax). The trigger is what is typed,\n * the same in every language; what it inserts is described by the catalog (`snippet.<trigger>`).\n */\nexport interface SqlSnippet { trigger: string; body: string }"),
("label: snippet.label, kind: monaco.languages.CompletionItemKind.Snippet, detail: snippet.detail,", "label: snippet.trigger, kind: monaco.languages.CompletionItemKind.Snippet, detail: tq(`snippet.${snippet.trigger}` as 'snippet.sel'),"),
("sortText: `9${snippet.label}`", "sortText: `9${snippet.trigger}`"),
]
def POST(s):
    return re.sub(r"\{ label: '(\w+)', detail: '[^']*', body:", r"{ trigger: '\1', body:", s)
