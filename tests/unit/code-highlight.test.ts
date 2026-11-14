import { describe, expect, test } from 'vitest'
import { highlightCode, languageId, languageName, MAX_HIGHLIGHT_CHARS, type CodeToken } from '../../src/components/Threads/codeHighlight'

const kinds = (tokens: CodeToken[]): Array<[string, string]> => tokens.filter(token => token.kind).map(token => [token.kind as string, token.text])
const text = (tokens: CodeToken[]): string => tokens.map(token => token.text).join('')

describe('code highlight: what a reader scans for, by family of language', () => {
  test('the pieces, joined back, are the code character for character', () => {
    const samples: Array<[string, string]> = [
      ['ts', 'const total = (items: Item[]): number => items.reduce((sum, item) => sum + item.price * item.qty, 0) // cents\n'],
      ['python', 'def total(items):\n    """Sum of price * qty."""\n    return sum(i["price"] * i["qty"] for i in items)  # cents\n'],
      ['sql', "SELECT id, name FROM users WHERE name = 'O''Brien' -- one\n"],
      ['json', '{ "name": "shop", "private": true, "port": 5173, "tags": ["a", null] }'],
      ['html', '<!-- hero --><section id="hero" class="a b"><button disabled>Buy</button></section>'],
      ['css', '.buy-button { color: #fff; padding: 14px 28px; /* big */ }\n@media (min-width: 600px) { a { margin: 0 } }'],
      ['diff', '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n same'],
      ['bash', 'export PORT=3000\nnpm run dev -- --port "$PORT" # start\n'],
      ['yaml', 'name: shop\nservices:\n  - web: true\n    image: "node:22"\n'],
      ['whatever', 'anything at all ~~ <> "unclosed'],
      ['js', 'const s = `unclosed template\nconst t = "unclosed\nlet u = \'x'],
      ['c', '/* unclosed comment\nint main() {']
    ]
    for (const [language, code] of samples) expect(text(highlightCode(code, language)), language).toBe(code)
  })

  test('TypeScript: keywords, strings, numbers, comments, calls and types', () => {
    const tokens = kinds(highlightCode("import { Item } from './item'\nexport function total(items: Item[]): number {\n  // cents\n  return items.length > 0 ? sum(items) : 0\n}", 'ts'))
    expect(tokens).toContainEqual(['keyword', 'import'])
    expect(tokens).toContainEqual(['type', 'Item'])
    expect(tokens).toContainEqual(['string', "'./item'"])
    expect(tokens).toContainEqual(['function', 'total'])
    expect(tokens).toContainEqual(['comment', '// cents'])
    expect(tokens).toContainEqual(['function', 'sum'])
    expect(tokens).toContainEqual(['number', '0'])
    expect(tokens).toContainEqual(['keyword', 'number'])
    // A property named like a keyword's neighbour stays plain: `items.length` has no colour.
    expect(tokens.find(([, value]) => value === 'length')).toBeUndefined()
  })

  test('a keyword inside a string or a comment is not a keyword', () => {
    const tokens = kinds(highlightCode('const a = "return if else" // function class', 'js'))
    expect(tokens).toEqual([['keyword', 'const'], ['string', '"return if else"'], ['comment', '// function class']])
  })

  test('Python: triple-quoted strings and hash comments', () => {
    const tokens = kinds(highlightCode('def f(x):\n    """doc\n    string"""\n    return None  # nothing', 'py'))
    expect(tokens).toContainEqual(['keyword', 'def'])
    expect(tokens).toContainEqual(['function', 'f'])
    expect(tokens).toContainEqual(['string', '"""doc\n    string"""'])
    expect(tokens).toContainEqual(['literal', 'None'])
    expect(tokens).toContainEqual(['comment', '# nothing'])
  })

  test('SQL keywords in any case; a doubled quote stays inside the string', () => {
    const tokens = kinds(highlightCode("select Name from Users where name = 'O''Brien'", 'sql'))
    expect(tokens.filter(([kind]) => kind === 'keyword').map(([, value]) => value)).toEqual(['select', 'from', 'where'])
    expect(tokens).toContainEqual(['string', "'O''Brien'"])
  })

  test('JSON: names apart from values', () => {
    const tokens = kinds(highlightCode('{ "name": "shop", "port": 5173, "ok": true }', 'json'))
    expect(tokens).toEqual([['attr', '"name"'], ['string', '"shop"'], ['attr', '"port"'], ['number', '5173'], ['attr', '"ok"'], ['literal', 'true']])
  })

  test('markup: tags, attribute names, quoted values and comments', () => {
    const tokens = kinds(highlightCode('<!-- a --><a href="/x" target=_blank>go</a>', 'html'))
    expect(tokens).toEqual([['comment', '<!-- a -->'], ['tag', '<a'], ['attr', 'href'], ['string', '"/x"'], ['attr', 'target'], ['tag', '>'], ['tag', '</a>']])
  })

  test('CSS: properties, numbers with units and at-rules', () => {
    const tokens = kinds(highlightCode('@media (min-width: 600px) { .a { padding: 14px; color: red } }', 'css'))
    expect(tokens).toContainEqual(['keyword', '@media'])
    expect(tokens).toContainEqual(['attr', 'min-width'])
    expect(tokens).toContainEqual(['number', '600px'])
    expect(tokens).toContainEqual(['attr', 'padding'])
    expect(tokens).toContainEqual(['attr', 'color'])
  })

  test('diff: added, removed and the lines that say where', () => {
    expect(kinds(highlightCode('@@ -1 +1 @@\n-old\n+new\n same', 'diff'))).toEqual([['meta', '@@ -1 +1 @@\n'], ['removed', '-old\n'], ['added', '+new\n']])
  })

  test('shell: variables and comments; YAML: keys', () => {
    expect(kinds(highlightCode('echo "$HOME" $PORT # hi', 'bash'))).toEqual([['keyword', 'echo'], ['string', '"$HOME"'], ['literal', '$PORT'], ['comment', '# hi']])
    const yaml = kinds(highlightCode('name: shop\nenabled: true\n', 'yaml'))
    expect(yaml).toEqual([['attr', 'name'], ['attr', 'enabled'], ['literal', 'true']])
  })

  test('an unknown language, plain text and a dump get no colour', () => {
    expect(highlightCode('fn main() {}', 'brainfuck')).toEqual([{ text: 'fn main() {}', kind: null }])
    expect(highlightCode('graph TD; A-->B', 'mermaid')).toEqual([{ text: 'graph TD; A-->B', kind: null }])
    expect(highlightCode('const a = 1', null)).toEqual([{ text: 'const a = 1', kind: null }])
    const dump = 'x'.repeat(MAX_HIGHLIGHT_CHARS + 1)
    expect(highlightCode(dump, 'js')).toEqual([{ text: dump, kind: null }])
  })

  test('the name on the block', () => {
    expect(languageId('language-TS')).toBe('ts')
    expect(languageId('hljs language-python extra')).toBe('python')
    expect(languageId(undefined)).toBeNull()
    expect(languageName('ts')).toBe('TypeScript')
    expect(languageName('c++')).toBe('C++')
    expect(languageName('ps1')).toBe('PowerShell')
    expect(languageName('zig')).toBe('zig')
    expect(languageName('not a language; <script>')).toBeNull()
    expect(languageName(null)).toBeNull()
  })

  test('ten thousand lines are scanned in well under a frame budget per thousand', () => {
    const code = Array.from({ length: 10_000 }, (_, i) => `const value${i} = compute(${i}, "text ${i}") // line ${i}`).join('\n').slice(0, MAX_HIGHLIGHT_CHARS)
    const started = performance.now()
    const tokens = highlightCode(code, 'ts')
    expect(text(tokens)).toBe(code)
    expect(performance.now() - started).toBeLessThan(400)
  })
})
