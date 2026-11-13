/**
 * Colour for the code an agent writes in a conversation: a small tokenizer by family of language (C-like, hash-comment,
 * SQL, JSON, markup, CSS, diff), not a grammar. It marks what a reader scans for — comments, strings, keywords, numbers,
 * names being called — and leaves the rest alone. A language it does not know gets its name on the block and no colour,
 * which is better than the wrong colour. Loaded on demand: a conversation without code never pays for it.
 */

export type TokenKind = 'comment' | 'string' | 'keyword' | 'number' | 'literal' | 'function' | 'type' | 'tag' | 'attr' | 'added' | 'removed' | 'meta'
export interface CodeToken { text: string; kind: TokenKind | null }

type Family = 'clike' | 'hash' | 'sql' | 'json' | 'markup' | 'css' | 'diff' | 'plain'
interface Language { name: string; family: Family; keywords?: ReadonlySet<string>; backticks?: boolean; slashComments?: boolean; dashComments?: boolean; semicolonComments?: boolean; variables?: boolean }

const words = (list: string): ReadonlySet<string> => new Set(list.split(' '))
const C_LIKE = words('abstract as async await break case catch class const continue debugger default delete do else enum export extends final finally for from function get if implements import in instanceof interface let new of package private protected public readonly return set static super switch this throw try type typeof var void while with yield namespace declare keyof satisfies struct func defer go map chan range select fn mut pub impl trait use mod match where ref move loop unsafe crate self Self using template typename virtual override sealed val fun when object companion data is guard internal operator sizeof goto union extern inline register volatile unsigned signed int long short char float double bool boolean byte string number any never unknown')
const PYTHON = words('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self')
const RUBY = words('alias and begin break case class def defined? do else elsif end ensure for if in module next not or redo rescue retry return self super then undef unless until when while yield require attr_accessor attr_reader')
const SHELL = words('if then else elif fi for in do done while until case esac function return export local readonly declare unset source alias echo cd exit set shift trap eval exec')
const POWERSHELL = words('function param if else elseif foreach for while do switch return break continue try catch finally throw begin process end in filter trap')
const SQL = words('select from where join left right inner outer full cross on group by order having insert into values update set delete create table alter drop index view as and or not null is in exists union all distinct limit offset case when then else end primary key foreign references default with returning begin commit rollback transaction constraint unique check between like ilike asc desc truncate grant revoke explain analyze add column if database schema trigger function procedure declare return cascade')
const LUA = words('and break do else elseif end for function goto if in local not or repeat return then until while')
const LITERALS = words('true false null undefined nil None True False NaN Infinity yes no on off TRUE FALSE NULL')

const LANGUAGES: Record<string, Language> = {}
const add = (ids: string, language: Language): void => { for (const id of ids.split(' ')) LANGUAGES[id] = language }
add('js javascript mjs cjs node', { name: 'JavaScript', family: 'clike', keywords: C_LIKE, backticks: true })
add('jsx', { name: 'JSX', family: 'clike', keywords: C_LIKE, backticks: true })
add('ts typescript mts cts', { name: 'TypeScript', family: 'clike', keywords: C_LIKE, backticks: true })
add('tsx', { name: 'TSX', family: 'clike', keywords: C_LIKE, backticks: true })
add('java', { name: 'Java', family: 'clike', keywords: C_LIKE })
add('c h', { name: 'C', family: 'clike', keywords: C_LIKE })
add('cpp c++ cc cxx hpp', { name: 'C++', family: 'clike', keywords: C_LIKE })
add('cs csharp c#', { name: 'C#', family: 'clike', keywords: C_LIKE })
add('go golang', { name: 'Go', family: 'clike', keywords: C_LIKE, backticks: true })
add('rust rs', { name: 'Rust', family: 'clike', keywords: C_LIKE })
add('kotlin kt kts', { name: 'Kotlin', family: 'clike', keywords: C_LIKE })
add('swift', { name: 'Swift', family: 'clike', keywords: C_LIKE })
add('php', { name: 'PHP', family: 'clike', keywords: C_LIKE, variables: true })
add('dart', { name: 'Dart', family: 'clike', keywords: C_LIKE })
add('scala', { name: 'Scala', family: 'clike', keywords: C_LIKE })
add('groovy gradle', { name: 'Groovy', family: 'clike', keywords: C_LIKE })
add('py python python3', { name: 'Python', family: 'hash', keywords: PYTHON })
add('rb ruby', { name: 'Ruby', family: 'hash', keywords: RUBY })
add('sh bash shell zsh console shellsession', { name: 'Shell', family: 'hash', keywords: SHELL, variables: true })
add('ps1 powershell pwsh', { name: 'PowerShell', family: 'hash', keywords: POWERSHELL, variables: true })
add('yaml yml', { name: 'YAML', family: 'hash' })
add('toml', { name: 'TOML', family: 'hash' })
add('ini conf properties env dotenv', { name: 'INI', family: 'hash', semicolonComments: true })
add('dockerfile docker', { name: 'Dockerfile', family: 'hash', keywords: words('FROM RUN CMD LABEL EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER WORKDIR ARG ONBUILD STOPSIGNAL HEALTHCHECK SHELL AS'), variables: true })
add('makefile make mk', { name: 'Makefile', family: 'hash', variables: true })
add('graphql gql', { name: 'GraphQL', family: 'hash', keywords: words('query mutation subscription fragment on type interface union enum input scalar schema extend directive implements') })
add('sql postgres postgresql pgsql mysql sqlite plsql tsql', { name: 'SQL', family: 'sql', keywords: SQL })
add('lua', { name: 'Lua', family: 'sql', keywords: LUA, dashComments: true })
add('json jsonc json5 jsonl', { name: 'JSON', family: 'json' })
add('html htm xhtml', { name: 'HTML', family: 'markup' })
add('xml xsd xsl plist', { name: 'XML', family: 'markup' })
add('svg', { name: 'SVG', family: 'markup' })
add('vue', { name: 'Vue', family: 'markup' })
add('svelte', { name: 'Svelte', family: 'markup' })
add('astro', { name: 'Astro', family: 'markup' })
add('css', { name: 'CSS', family: 'css' })
add('scss sass', { name: 'SCSS', family: 'css', slashComments: true })
add('less', { name: 'Less', family: 'css', slashComments: true })
add('diff patch', { name: 'Diff', family: 'diff' })
add('md markdown mdx', { name: 'Markdown', family: 'plain' })
add('text txt plaintext plain log output', { name: 'Text', family: 'plain' })
add('mermaid', { name: 'Mermaid', family: 'plain' })

/** Past this size a block is shown without colour: it is a dump, and colouring it would cost more than it tells. */
export const MAX_HIGHLIGHT_CHARS = 60_000

/** The id written after the fence ("```ts"), as the Markdown parser hands it: `language-ts`. */
export function languageId(className: string | undefined): string | null {
  const match = /(?:^|\s)language-([^\s]+)/.exec(className ?? '')
  return match ? match[1].toLowerCase() : null
}

/** How the language is named on the block: its own name when known, what the agent wrote otherwise. */
export function languageName(id: string | null): string | null {
  if (!id) return null
  return LANGUAGES[id]?.name ?? (/^[\w+#.-]{1,24}$/.test(id) ? id : null)
}

const NUMBER = String.raw`\b0[xX][0-9a-fA-F_]+\b|\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?[a-zA-Z%]*\b`
const DOUBLE = String.raw`"(?:\\[\s\S]|[^"\\\n])*"?`
const SINGLE = String.raw`'(?:\\[\s\S]|[^'\\\n])*'?`

/** One sticky expression per language: comment | string | number | variable | word | anything else, one at a time. */
function scanner(language: Language): RegExp {
  const comments: string[] = []
  const strings = [DOUBLE, SINGLE]
  if (language.family === 'clike') { comments.push(String.raw`\/\/[^\n]*`, String.raw`\/\*[\s\S]*?(?:\*\/|$)`); if (language.backticks) strings.push('`(?:\\\\[\\s\\S]|[^`\\\\])*`?') }
  if (language.family === 'hash') { comments.push(String.raw`#[^\n]*`); if (language.semicolonComments) comments.push(String.raw`;[^\n]*`); strings.unshift(String.raw`"""[\s\S]*?(?:"""|$)`, String.raw`'''[\s\S]*?(?:'''|$)`) }
  if (language.family === 'sql') { comments.push(String.raw`--[^\n]*`, String.raw`\/\*[\s\S]*?(?:\*\/|$)`); strings.splice(0, strings.length, String.raw`'(?:''|[^'])*'?`, DOUBLE) }
  if (language.family === 'css') { comments.push(String.raw`\/\*[\s\S]*?(?:\*\/|$)`); if (language.slashComments) comments.push(String.raw`\/\/[^\n]*`) }
  const variable = language.variables ? String.raw`\$\{?[A-Za-z_][\w:]*\}?` : '(?!)'
  // A hyphen is part of a name in CSS, YAML and shell flags; in C-like code, SQL and JSON it is an operator.
  const tail = language.family === 'clike' || language.family === 'sql' || language.family === 'json' ? '[\\w$]*' : '[\\w$-]*'
  return new RegExp(`(${comments.join('|') || '(?!)'})|(${strings.join('|')})|(${NUMBER})|(${variable})|([A-Za-z_$@]${tail})|(\\s+)|([\\s\\S])`, 'y')
}

function push(out: CodeToken[], text: string, kind: TokenKind | null): void {
  const last = out[out.length - 1]
  if (last && last.kind === kind) last.text += text
  else out.push({ text, kind })
}

function scan(code: string, language: Language): CodeToken[] {
  const out: CodeToken[] = []
  const expression = scanner(language)
  const keywords = language.keywords
  const insensitive = language.family === 'sql'
  let match: RegExpExecArray | null
  expression.lastIndex = 0
  while (expression.lastIndex < code.length && (match = expression.exec(code))) {
    const [text, comment, string, number, variable, word] = match
    if (text.length === 0) { expression.lastIndex++; continue }
    if (comment) push(out, text, 'comment')
    else if (string) {
      // In JSON, and in YAML's quoted keys, a string before a colon is a name, not a value.
      const isKey = (language.family === 'json' || language.name === 'YAML') && /^\s*:/.test(code.slice(expression.lastIndex, expression.lastIndex + 8))
      push(out, text, isKey ? 'attr' : 'string')
    } else if (number) push(out, text, 'number')
    else if (variable) push(out, text, 'literal')
    else if (word) {
      const rest = code.slice(expression.lastIndex, expression.lastIndex + 8)
      if (keywords?.has(insensitive ? word.toLowerCase() : word)) push(out, text, 'keyword')
      else if (LITERALS.has(word)) push(out, text, 'literal')
      else if (language.family === 'css' && /^\s*:/.test(rest) && !/^\s*:[\w-]/.test(rest)) push(out, text, 'attr')
      else if (language.family === 'css' && word.startsWith('@')) push(out, text, 'keyword')
      else if ((language.name === 'YAML' || language.name === 'TOML' || language.name === 'INI') && /^\s*[:=]/.test(rest) && isLineStart(code, match.index)) push(out, text, 'attr')
      else if (language.family !== 'css' && language.family !== 'json' && /^\s*\(/.test(rest) && !word.startsWith('@')) push(out, text, 'function')
      else if (language.family === 'clike' && /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/.test(word)) push(out, text, 'type')
      else push(out, text, null)
    } else push(out, text, null)
  }
  return out
}

const isLineStart = (code: string, index: number): boolean => /(^|\n)[ \t-]*$/.test(code.slice(Math.max(0, index - 80), index))

/** Tags, attribute names and quoted values; text between tags stays plain. */
function scanMarkup(code: string): CodeToken[] {
  const out: CodeToken[] = []
  const expression = /(<!--[\s\S]*?(?:-->|$))|(<\/?[A-Za-z][\w:.-]*|\/?>)|([\s\S])/y
  const inside = /("[^"]*"?|'[^']*'?)|([\w:@.#-]+)(?=\s*=)|(\/?>)|([\s\S])/y
  let index = 0
  while (index < code.length) {
    expression.lastIndex = index
    const match = expression.exec(code)
    if (!match) break
    index = expression.lastIndex
    if (match[1]) { push(out, match[0], 'comment'); continue }
    if (!match[2] || match[2].endsWith('>')) { push(out, match[0], match[2] ? 'tag' : null); continue }
    push(out, match[0], 'tag')
    // Inside the tag, up to its end.
    while (index < code.length) {
      inside.lastIndex = index
      const part = inside.exec(code)
      if (!part) break
      index = inside.lastIndex
      if (part[1]) push(out, part[0], 'string')
      else if (part[2]) push(out, part[0], 'attr')
      else if (part[3]) { push(out, part[0], 'tag'); break }
      else push(out, part[0], null)
    }
  }
  return out
}

function scanDiff(code: string): CodeToken[] {
  const out: CodeToken[] = []
  const lines = code.split('\n')
  lines.forEach((line, index) => {
    const kind: TokenKind | null = /^(@@|diff |index |--- |\+\+\+ )/.test(line) ? 'meta' : line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : null
    push(out, index < lines.length - 1 ? `${line}\n` : line, kind)
  })
  return out.filter(token => token.text.length > 0)
}

/** The code as pieces to colour. Joined back, the pieces are the code, character for character. */
export function highlightCode(code: string, id: string | null): CodeToken[] {
  const language = id ? LANGUAGES[id] : undefined
  if (!language || language.family === 'plain' || code.length > MAX_HIGHLIGHT_CHARS) return [{ text: code, kind: null }]
  if (language.family === 'diff') return scanDiff(code)
  if (language.family === 'markup') return scanMarkup(code)
  return scan(code, language)
}
