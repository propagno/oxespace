/* Syntax coloring for SQL, JSON, TypeScript, shell and diffs, plus an editor that colors as you type
   (a highlighted layer under a transparent textarea) and a code block with a file header and copy. */
import { Fragment, useRef, type ReactNode } from 'react'
import { emit, toast } from '../state/store'
import { Icon } from './ui'

export type Lang = 'sql' | 'json' | 'ts' | 'shell' | 'diff' | 'text' | 'url'
const SQL_KW = 'SELECT|FROM|WHERE|AND|OR|NOT|NULL|IS|IN|AS|ON|JOIN|LEFT|RIGHT|INNER|OUTER|GROUP|BY|ORDER|LIMIT|OFFSET|UPDATE|SET|INSERT|INTO|VALUES|DELETE|CREATE|TABLE|INDEX|CONCURRENTLY|PRIMARY|KEY|DEFAULT|EXPLAIN|ANALYZE|ANY|DISTINCT|HAVING|RETURNING|BEGIN|COMMIT|ROLLBACK|FOR|WITH|CASE|WHEN|THEN|ELSE|END|ASC|DESC|TRUE|FALSE'
const TS_KW = 'export|import|from|const|let|var|function|return|if|else|async|await|new|throw|type|interface|for|of|in|class|extends|null|undefined|true|false|try|catch'
type Rule = [RegExp, string]
const RULES: Record<string, Rule[]> = {
  sql: [[/--[^\n]*/y, 'cm'], [/'(?:[^']|'')*'/y, 'str'], [new RegExp(`\\b(?:${SQL_KW})\\b`, 'iy'), 'kw'], [/\b(?:count|sum|avg|min|max|now|coalesce|lower|upper|date_trunc)(?=\s*\()/iy, 'fn'], [/\b\d+(?:\.\d+)?\b/y, 'num'], [/[(),;*=<>!.]+/y, 'pun']],
  json: [[/"(?:[^"\\]|\\.)*"(?=\s*:)/y, 'key'], [/"(?:[^"\\]|\\.)*"/y, 'str'], [/\b-?\d+(?:\.\d+)?\b/y, 'num'], [/\b(?:true|false|null)\b/y, 'kw'], [/[{}[\],:]/y, 'pun'], [/…[^\n,}\]]*/y, 'cm']],
  ts: [[/\/\/[^\n]*/y, 'cm'], [/`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/y, 'str'], [new RegExp(`\\b(?:${TS_KW})\\b`, 'y'), 'kw'], [/\b[A-Z][A-Za-z0-9]*\b/y, 'type'], [/\b[a-zA-Z_]\w*(?=\s*\()/y, 'fn'], [/\b\d+(?:\.\d+)?\b/y, 'num']],
  shell: [[/#[^\n]*/y, 'cm'], [/'[^']*'|"[^"]*"/y, 'str'], [/(?:^|(?<=\n))\s*[$>]\s/y, 'pun'], [/\s--?[a-zA-Z][\w-]*/y, 'flag'], [/(?:^|(?<=[\n|&;]\s*))(?:npm|npx|git|docker|psql|curl|claude|codex|node|tsx|ls|cd|cat|grep)\b/y, 'kw']],
  url: [[/\{\{[a-z_]+\}\}/y, 'var'], [/[?&][a-z_]+=/y, 'key']]
}
/** Split code into colored spans. Plain loop over sticky regexes: no dependency, good enough for mock data. */
export function tokens (src: string, lang: Lang): ReactNode[] {
  if (lang === 'diff') return src.split('\n').map((l, i) => <Fragment key={i}><span className={l.startsWith('+') ? 'tk-add' : l.startsWith('-') ? 'tk-del' : l.startsWith('@@') ? 'tk-hunk' : ''}>{l}</span>{'\n'}</Fragment>)
  const rules = RULES[lang]; if (!rules) return [src]
  const out: ReactNode[] = []; let i = 0, plain = ''
  while (i < src.length) {
    let hit: [string, string] | null = null
    for (const [re, cls] of rules) { re.lastIndex = i; const m = re.exec(src); if (m && m.index === i && m[0].length) { hit = [m[0], cls]; break } }
    if (hit) { if (plain) { out.push(plain); plain = '' } out.push(<span key={i} className={'tk-' + hit[1]}>{hit[0]}</span>); i += hit[0].length }
    else { plain += src[i]; i++ }
  }
  if (plain) out.push(plain)
  return out
}
export const Hl = ({ s, lang }: { s: string; lang: Lang }) => <>{tokens(s, lang)}</>

/** A code editor: line numbers, coloring under a transparent textarea, Tab inserts two spaces. */
export function CodeEditor ({ value, onChange, lang, label, placeholder, readOnly, onRun }: { value: string; onChange?: (v: string) => void; lang: Lang; label: string; placeholder?: string; readOnly?: boolean; onRun?: () => void }) {
  const layer = useRef<HTMLPreElement>(null); const gut = useRef<HTMLDivElement>(null)
  const lines = Math.max(1, value.split('\n').length)
  return <div className={'ced' + (readOnly ? ' ro' : '')}>
    <div className="ced-g" ref={gut} aria-hidden="true">{Array.from({ length: lines }, (_, i) => <span key={i}>{i + 1}</span>)}</div>
    <div className="ced-b"><pre className="ced-l" ref={layer} aria-hidden="true">{value ? tokens(value, lang) : <span className="ced-ph">{placeholder}</span>}{'\n'}</pre>
      <textarea aria-label={label} spellCheck={false} value={value} readOnly={readOnly} onChange={e => { onChange && onChange(e.target.value); emit() }}
        onScroll={e => { const t = e.currentTarget; if (layer.current) { layer.current.scrollTop = t.scrollTop; layer.current.scrollLeft = t.scrollLeft } if (gut.current) gut.current.scrollTop = t.scrollTop }}
        onKeyDown={e => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && onRun) { e.preventDefault(); onRun(); return }
          if (e.key === 'Tab' && !readOnly && onChange) { e.preventDefault(); const t = e.currentTarget, a = t.selectionStart, b = t.selectionEnd; onChange(value.slice(0, a) + '  ' + value.slice(b)); emit(); requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = a + 2 }) }
        }} /></div></div>
}
/** A read-only block with a header (file or language), copy, and optional line numbers. */
export function CodeBlock ({ code, lang, title, numbers }: { code: string; lang: Lang; title?: string; numbers?: boolean }) {
  const ls = code.split('\n')
  return <div className="cblk"><div className="cblk-h"><span className="mono">{title || lang}</span><span className="sp" /><button className="ibtn sm" aria-label="Copy code" title="Copy" onClick={() => { toast('Copied'); emit() }}><Icon n="copy" s={12} /></button></div>
    <pre className={'cblk-b' + (numbers ? ' num' : '')}>{numbers ? ls.map((l, i) => <span key={i} className="ln"><i>{i + 1}</i>{tokens(l, lang)}{'\n'}</span>) : tokens(code, lang)}</pre></div>
}
/** A JSON response viewer: pretty or raw. */
export function prettyJson (s: string) { try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s } }
