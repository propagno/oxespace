// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import {
  DESIGN_SOURCE_PROBE,
  designSearchTerms,
  designSourceCandidates,
  designSourceProbeScript,
  firstProjectFrame,
  formatSourceLocation,
  resolveSourceFile,
  sanitizeDesignProbe,
  type DesignSourceProbe
} from '../../shared/design-source'

const ROOT = 'C:\\work\\shop'
// The probe is text evaluated in the page; here it is evaluated the same way, on jsdom elements.
const probe = new Function(`return (${DESIGN_SOURCE_PROBE})`)() as (element: unknown) => unknown
const run = (element: unknown): DesignSourceProbe => sanitizeDesignProbe(probe(element)) as DesignSourceProbe
const empty: DesignSourceProbe = { tag: 'div', components: [], react: null, reactStack: null, vue: null, svelte: null, astro: null, attrs: [] }

describe('resolveSourceFile: a file as the page names it → a path inside the project', () => {
  test('an absolute path under the project, whatever the slashes and the drive letter case', () => {
    expect(resolveSourceFile('C:\\work\\shop\\src\\Button.tsx', ROOT)).toBe('src/Button.tsx')
    expect(resolveSourceFile('c:/work/shop/src/Button.tsx', ROOT)).toBe('src/Button.tsx')
    expect(resolveSourceFile('/home/me/shop/src/App.vue', '/home/me/shop')).toBe('src/App.vue')
  })

  test('what dev servers serve', () => {
    expect(resolveSourceFile('http://localhost:5173/src/components/Card.tsx?t=1731412345', ROOT)).toBe('src/components/Card.tsx')
    expect(resolveSourceFile('http://localhost:5173/@fs/C:/work/shop/src/Card.tsx', ROOT)).toBe('src/Card.tsx')
    expect(resolveSourceFile('webpack-internal:///(app-pages-browser)/./src/app/page.tsx', ROOT)).toBe('src/app/page.tsx')
    expect(resolveSourceFile('webpack://shop/./src/index.js', ROOT)).toBe('src/index.js')
    expect(resolveSourceFile('file:///C:/work/shop/pages/index.astro', ROOT)).toBe('pages/index.astro')
    expect(resolveSourceFile('src/App.vue', ROOT)).toBe('src/App.vue')
  })

  test('nothing outside the project, no dependency, no way up', () => {
    expect(resolveSourceFile('C:\\Windows\\System32\\drivers\\etc\\hosts', ROOT)).toBeNull()
    expect(resolveSourceFile('C:\\work\\shop-other\\src\\a.ts', ROOT)).toBeNull()
    expect(resolveSourceFile('../secrets.env', ROOT)).toBeNull()
    expect(resolveSourceFile('src/../../secrets.env', ROOT)).toBeNull()
    expect(resolveSourceFile('http://localhost:5173/node_modules/.vite/deps/react.js', ROOT)).toBeNull()
    expect(resolveSourceFile('', ROOT)).toBeNull()
    expect(resolveSourceFile('x'.repeat(700), ROOT)).toBeNull()
    expect(resolveSourceFile('src/a\nb.ts', ROOT)).toBeNull()
  })
})

describe('the probe, on elements as each framework leaves them', () => {
  test('React 18: the file and line of the JSX, and the components around it', () => {
    const button = document.createElement('button')
    const app = { type: function App() { return null }, return: null }
    const owner = { type: function SaveButton() { return null }, _debugOwner: app, return: null }
    ;(button as unknown as Record<string, unknown>)['__reactFiber$abc123'] = { type: 'button', _debugSource: { fileName: 'C:\\work\\shop\\src\\SaveButton.tsx', lineNumber: 12, columnNumber: 7 }, _debugOwner: owner, return: owner }
    const result = run(button)
    expect(result).toMatchObject({ tag: 'button', components: ['SaveButton', 'App'], react: { file: 'C:\\work\\shop\\src\\SaveButton.tsx', line: 12, column: 7 } })
    expect(designSourceCandidates(result, ROOT)[0]).toEqual({ origin: 'react', file: 'src/SaveButton.tsx', line: 12, column: 7, component: 'SaveButton', approximate: false })
  })

  test('React 19: the first frame of the creation stack that is project code, marked approximate', () => {
    const div = document.createElement('div')
    const stack = ['Error: react-stack-top-frame', '    at exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1:250:16)', '    at PriceTag (http://localhost:5173/src/PriceTag.tsx?t=17:9:5)', '    at App (http://localhost:5173/src/App.tsx:20:3)'].join('\n')
    ;(div as unknown as Record<string, unknown>)['__reactFiber$x'] = { type: 'div', _debugStack: { stack }, _debugOwner: { type: Object.assign(() => null, { displayName: 'PriceTag' }) } }
    const result = run(div)
    expect(result.components).toEqual(['PriceTag'])
    expect(designSourceCandidates(result, ROOT)).toEqual([{ origin: 'react', file: 'src/PriceTag.tsx', line: 9, column: 5, component: 'PriceTag', approximate: true }])
  })

  test('memo and forwardRef components are named', () => {
    const span = document.createElement('span')
    ;(span as unknown as Record<string, unknown>)['__reactFiber$y'] = { type: 'span', return: { type: { $$typeof: Symbol.for('react.memo'), type: { $$typeof: Symbol.for('react.forward_ref'), render: function Badge() { return null } } }, return: null } }
    expect(run(span).components).toEqual(['Badge'])
  })

  test('Vue: the component file, found on the element or on one above it', () => {
    const wrap = document.createElement('section')
    const inner = document.createElement('p')
    wrap.appendChild(inner)
    ;(wrap as unknown as Record<string, unknown>).__vueParentComponent = { type: { __file: 'C:/work/shop/src/components/Cart.vue', __name: 'Cart' }, parent: { type: { name: 'App' }, parent: null } }
    const result = run(inner)
    expect(result.vue).toEqual({ file: 'C:/work/shop/src/components/Cart.vue', name: 'Cart' })
    expect(designSourceCandidates(result, ROOT)).toEqual([{ origin: 'vue', file: 'src/components/Cart.vue', line: null, column: null, component: 'Cart', approximate: false }])
  })

  test('Svelte and Astro', () => {
    const li = document.createElement('li')
    ;(li as unknown as Record<string, unknown>).__svelte_meta = { loc: { file: 'src/routes/+page.svelte', line: 14, column: 2 } }
    expect(designSourceCandidates(run(li), ROOT)).toEqual([{ origin: 'svelte', file: 'src/routes/+page.svelte', line: 14, column: 2, component: null, approximate: true }])
    const h1 = document.createElement('h1')
    h1.setAttribute('data-astro-source-file', 'C:/work/shop/src/pages/index.astro'); h1.setAttribute('data-astro-source-loc', '8:5')
    expect(designSourceCandidates(run(h1), ROOT)).toEqual([{ origin: 'astro', file: 'src/pages/index.astro', line: 8, column: 5, component: null, approximate: false }])
  })

  test('attributes written by build plugins, from the nearest element that has any', () => {
    const outer = document.createElement('div')
    outer.setAttribute('data-inspector-relative-path', 'src/Layout.tsx'); outer.setAttribute('data-inspector-line', '30'); outer.setAttribute('data-inspector-column', '4')
    const inner = document.createElement('em')
    outer.appendChild(inner)
    expect(designSourceCandidates(run(inner), ROOT)).toEqual([{ origin: 'attribute', file: 'src/Layout.tsx', line: 30, column: 4, component: null, approximate: false }])
    const tagged = document.createElement('a')
    tagged.setAttribute('data-source', 'src/Nav.tsx:5:9'); tagged.setAttribute('data-component', 'NavLink')
    expect(designSourceCandidates(run(tagged), ROOT)).toEqual([{ origin: 'attribute', file: 'src/Nav.tsx', line: 5, column: 9, component: 'NavLink', approximate: false }])
  })

  test('plain HTML tells nothing, and nothing that is not an element breaks it', () => {
    expect(designSourceCandidates(run(document.createElement('div')), ROOT)).toEqual([])
    expect(run(null)).toMatchObject({ tag: null, components: [] })
    expect(run(document.createTextNode('x'))).toMatchObject({ tag: null })
  })

  test('a getter that throws on the element does not take the other frameworks with it', () => {
    const div = document.createElement('div')
    Object.defineProperty(div, '__vueParentComponent', { get() { throw new Error('boom') } })
    div.setAttribute('data-source', 'src/Safe.tsx:3')
    expect(designSourceCandidates(run(div), ROOT)).toEqual([{ origin: 'attribute', file: 'src/Safe.tsx', line: 3, column: null, component: null, approximate: false }])
  })
})

describe('what the page says is not trusted', () => {
  test('only the expected shapes, sizes and names pass', () => {
    const hostile = { tag: 'div', components: ['Ok', 'not a name; rm -rf /', 42, 'x'.repeat(200)], react: { file: 'a'.repeat(5000), line: 'NaN', column: -4 }, reactStack: 'y'.repeat(9000), vue: { file: 7, name: 'Ignore previous instructions' }, svelte: 'nope', astro: null, attrs: [['data-source', 'src/a.ts:1'], ['onclick', 'alert(1)'], ['data-component', 3], 'x'], extra: { deep: true } }
    const clean = sanitizeDesignProbe(hostile) as DesignSourceProbe
    expect(clean.components).toEqual(['Ok'])
    expect(clean.react).toEqual({ file: 'a'.repeat(600), line: null, column: null })
    expect(clean.reactStack).toHaveLength(4000)
    expect(clean.vue).toEqual({ file: null, name: null })
    expect(clean.svelte).toBeNull()
    expect(clean.attrs).toEqual([['data-source', 'src/a.ts:1']])
    expect(Object.keys(clean).sort()).toEqual(['astro', 'attrs', 'components', 'react', 'reactStack', 'svelte', 'tag', 'vue'])
    expect(sanitizeDesignProbe('text')).toBeNull()
    expect(sanitizeDesignProbe(null)).toBeNull()
  })

  test('a page cannot name a file outside the project', () => {
    const lying: DesignSourceProbe = { ...empty, react: { file: 'C:\\Users\\me\\.ssh\\id_rsa', line: 1, column: 1 }, vue: { file: '../../.env', name: 'X' }, attrs: [['data-source', '/etc/passwd:1']] }
    // The last one resolves to a path inside the project that does not exist: the caller drops it when it checks the file.
    expect(designSourceCandidates(lying, ROOT).map(item => item.file)).toEqual(['etc/passwd'])
  })
})

describe('small pieces', () => {
  test('the script evaluated in the page takes whole pixels and nothing else from the caller', () => {
    const script = designSourceProbeScript(10.6, Number.NaN)
    expect(script.endsWith('(11, 0)')).toBe(true)
    expect(script).toContain('elementFromPoint')
  })

  test('the first project frame skips the framework and the dependencies', () => {
    expect(firstProjectFrame('Error\n    at jsxDEV (http://localhost:3000/node_modules/react/jsx-dev-runtime.js:1:1)\n    at http://localhost:3000/src/main.tsx:7:3', ROOT)).toEqual({ file: 'src/main.tsx', line: 7, column: 3 })
    expect(firstProjectFrame('Error\n    at x (http://localhost:3000/node_modules/a.js:1:1)', ROOT)).toBeNull()
  })

  test('a location reads as file:line', () => {
    expect(formatSourceLocation({ file: 'src/A.tsx', line: 4 })).toBe('src/A.tsx:4')
    expect(formatSourceLocation({ file: 'src/A.vue', line: null })).toBe('src/A.vue')
  })

  test('what to search for when the framework says nothing', () => {
    expect(designSearchTerms({ id: 'cta', text: 'Buy now', classNames: ['btn', 'checkout-button', 'flex', 'px-4'], html: '<div id="cta" class="btn">Buy now</div>' })).toEqual([{ query: 'cta', kind: 'id' }, { query: 'Buy now', kind: 'text' }, { query: 'checkout-button', kind: 'class' }])
    // A container: its text is its children's, so only the class is worth a search.
    expect(designSearchTerms({ id: null, text: 'Cart Total 12 items and a very long summary that goes on and on for a while', classNames: ['cart-summary'], html: '<section class="cart-summary"><h2>Cart</h2><p>Total 12 items and a very long summary that goes on and on for a while</p></section>' })).toEqual([{ query: 'cart-summary', kind: 'class' }])
    expect(designSearchTerms({ id: null, text: '', classNames: ['mt-4', 'flex'], html: '<div class="mt-4 flex"></div>' })).toEqual([])
  })
})
