/**
 * Design Mode, element → code. A picked element is described by the page (selector, markup, styles); this adds where it
 * is written: the file, the line and the component, as the framework's own development data tells it.
 *
 * Three steps, each in the process that can do it:
 *  1. `DESIGN_SOURCE_PROBE` runs in the previewed page's own world (the guest preload is isolated and cannot see what
 *     React, Vue or Svelte hang on the elements) and returns raw hints.
 *  2. `sanitizeDesignProbe` (main) keeps only bounded strings and numbers: the page is not trusted.
 *  3. `designSourceCandidates` (renderer) turns the hints into paths inside the project. The caller keeps a candidate
 *     only when that file exists in the project, so a page can point at a file of the project and at nothing else.
 */

/** What the page told about the element. Every string is capped; nothing here is trusted. */
export interface DesignSourceProbe {
  tag: string | null
  /** Nearest component first. */
  components: string[]
  react: { file: string | null; line: number | null; column: number | null } | null
  /** React 19 keeps the stack of where the element was created instead of a file and a line. */
  reactStack: string | null
  vue: { file: string | null; name: string | null } | null
  svelte: { file: string | null; line: number | null; column: number | null } | null
  astro: { file: string | null; loc: string | null } | null
  /** Attributes written by build plugins (react-dev-inspector, LocatorJS, Sentry…), from the nearest element that has any. */
  attrs: Array<[string, string]>
}

export type DesignSourceOrigin = 'react' | 'vue' | 'svelte' | 'astro' | 'attribute' | 'search'

export interface DesignGrabSource {
  origin: DesignSourceOrigin
  /** Relative to the project root, forward slashes. */
  file: string
  line: number | null
  column: number | null
  component: string | null
  /** The position comes from served code or from a text search: it can be a few lines off. */
  approximate: boolean
}

const MAX_STRING = 600
const COMPONENT_NAME = /^[A-Za-z_$][\w$.]{0,63}$/
const SOURCE_ATTRIBUTES = [
  'data-inspector-relative-path', 'data-inspector-line', 'data-inspector-column', 'data-source', 'data-source-file',
  'data-source-line', 'data-sentry-source-file', 'data-sentry-component', 'data-component', 'data-locatorjs-id', 'data-oxe-source'
]

/**
 * `function (element) → hints`, as text: it is evaluated in the page, where nothing of this bundle exists, so it is
 * plain ES5 with no helper the build could add (the main bundle is built with `keepNames`, which wraps functions).
 */
export const DESIGN_SOURCE_PROBE = `function (start) {
  var MAX = ${MAX_STRING};
  var ATTRS = ${JSON.stringify(SOURCE_ATTRIBUTES)};
  function str(v) { return typeof v === 'string' && v ? v.slice(0, MAX) : null; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function nameOf(type) {
    if (!type) return null;
    if (typeof type === 'function') return str(type.displayName || type.name);
    if (typeof type === 'object') return str(type.displayName) || nameOf(type.render) || nameOf(type.type);
    return null;
  }
  function fiberOf(el) {
    var keys = Object.keys(el);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf('__reactFiber$') === 0 || keys[i].indexOf('__reactInternalInstance$') === 0) return el[keys[i]];
    }
    return null;
  }
  var out = { tag: null, components: [], react: null, reactStack: null, vue: null, svelte: null, astro: null, attrs: [] };
  if (!start || start.nodeType !== 1) return out;
  out.tag = str(start.localName);
  try {
    var node = fiberOf(start);
    var hops = 0;
    while (node && hops < 40) {
      var src = node._debugSource;
      if (!out.react && src && typeof src.fileName === 'string') out.react = { file: str(src.fileName), line: num(src.lineNumber), column: num(src.columnNumber) };
      var stack = node._debugStack;
      if (!out.reactStack && stack && typeof stack.stack === 'string') out.reactStack = stack.stack.slice(0, 4000);
      var name = typeof node.type === 'string' ? null : (nameOf(node.type) || (node.tag === undefined ? str(node.name) : null));
      if (name && out.components.length < 6 && out.components.indexOf(name) < 0) out.components.push(name);
      node = node._debugOwner || node.owner || node.return;
      hops++;
    }
  } catch (e) {}
  try {
    var v = start;
    var vh = 0;
    while (v && vh < 12 && !out.vue) {
      var inst = v.__vueParentComponent;
      if (inst && inst.type) {
        out.vue = { file: str(inst.type.__file), name: str(inst.type.name || inst.type.__name) };
        var up = inst;
        var uh = 0;
        while (up && uh < 6) {
          var vn = up.type ? str(up.type.name || up.type.__name) : null;
          if (vn && out.components.length < 6 && out.components.indexOf(vn) < 0) out.components.push(vn);
          up = up.parent;
          uh++;
        }
      } else if (v.__vue__ && v.__vue__.$options) {
        out.vue = { file: str(v.__vue__.$options.__file), name: str(v.__vue__.$options.name || v.__vue__.$options._componentTag) };
      }
      v = v.parentElement;
      vh++;
    }
  } catch (e) {}
  try {
    var s = start;
    var sh = 0;
    while (s && sh < 12 && !out.svelte) {
      var meta = s.__svelte_meta;
      if (meta && meta.loc && typeof meta.loc.file === 'string') out.svelte = { file: str(meta.loc.file), line: num(meta.loc.line), column: num(meta.loc.column) };
      s = s.parentElement;
      sh++;
    }
  } catch (e) {}
  try {
    var a = start;
    var ah = 0;
    while (a && ah < 12) {
      if (a.getAttribute) {
        var file = a.getAttribute('data-astro-source-file');
        if (file && !out.astro) out.astro = { file: str(file), loc: str(a.getAttribute('data-astro-source-loc')) };
        if (out.attrs.length === 0) {
          for (var i = 0; i < ATTRS.length; i++) {
            var value = str(a.getAttribute(ATTRS[i]));
            if (value) out.attrs.push([ATTRS[i], value]);
          }
        }
      }
      a = a.parentElement;
      ah++;
    }
  } catch (e) {}
  return out;
}`

/** The script main evaluates in the page: the element under the point the person clicked (through open shadow roots). */
export function designSourceProbeScript(x: number, y: number): string {
  const px = Number.isFinite(x) ? Math.round(x) : 0
  const py = Number.isFinite(y) ? Math.round(y) : 0
  return `(function (x, y) { try { var el = document.elementFromPoint(x, y); var depth = 0; while (el && el.shadowRoot && depth < 5) { var inner = el.shadowRoot.elementFromPoint(x, y); if (!inner || inner === el) break; el = inner; depth++; } return (${DESIGN_SOURCE_PROBE})(el); } catch (e) { return null; } })(${px}, ${py})`
}

const text = (value: unknown, max = MAX_STRING): string | null => typeof value === 'string' && value.length > 0 ? value.slice(0, max) : null
const count = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 10_000_000 ? Math.floor(value) : null
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

/** Keeps what has the expected shape and size; anything else the page returned is dropped. */
export function sanitizeDesignProbe(raw: unknown): DesignSourceProbe | null {
  const value = record(raw)
  if (!value) return null
  const react = record(value.react)
  const vue = record(value.vue)
  const svelte = record(value.svelte)
  const astro = record(value.astro)
  return {
    tag: text(value.tag, 40),
    components: (Array.isArray(value.components) ? value.components : []).filter((name): name is string => typeof name === 'string' && COMPONENT_NAME.test(name)).slice(0, 6),
    react: react ? { file: text(react.file), line: count(react.line), column: count(react.column) } : null,
    reactStack: text(value.reactStack, 4000),
    vue: vue ? { file: text(vue.file), name: typeof vue.name === 'string' && COMPONENT_NAME.test(vue.name) ? vue.name : null } : null,
    svelte: svelte ? { file: text(svelte.file), line: count(svelte.line), column: count(svelte.column) } : null,
    astro: astro ? { file: text(astro.file), loc: text(astro.loc, 40) } : null,
    attrs: (Array.isArray(value.attrs) ? value.attrs : [])
      .filter((pair): pair is [string, string] => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && SOURCE_ATTRIBUTES.includes(pair[0]) && typeof pair[1] === 'string')
      .slice(0, SOURCE_ATTRIBUTES.length)
      .map(([name, attr]) => [name, attr.slice(0, MAX_STRING)] as [string, string])
  }
}

const decode = (value: string): string => { try { return decodeURIComponent(value) } catch { return value } }
const isDrivePath = (value: string): boolean => /^[A-Za-z]:\//.test(value)

/**
 * A file as a framework or a dev server names it (an absolute path, a `file:` or `http:` URL, `webpack://…`, Vite's
 * `/@fs/…`) → the path inside the project, or null when it is outside it or is not a project file at all.
 */
export function resolveSourceFile(raw: string, rootPath: string): string | null {
  let value = raw.trim()
  if (!value || value.length > MAX_STRING) return null
  value = value.replace(/[?#].*$/, '')
  let fromUrl = false
  if (/^file:\/\//i.test(value)) {
    value = decode(value.slice('file://'.length))
    if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1)
  } else if (/^https?:\/\//i.test(value)) {
    const path = /^https?:\/\/[^/]+(\/.*)?$/i.exec(value)?.[1] ?? ''
    value = decode(path)
    if (value.startsWith('/@fs/')) { value = value.slice('/@fs'.length); if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1) } else fromUrl = true
  } else {
    value = value.replace(/^webpack-internal:\/\/\//, '').replace(/^webpack:\/\/[^/]*\//, '').replace(/^rsc:\/\/[^/]*\/[^/]*\//, '')
    value = decode(value)
  }
  value = value.replace(/\\/g, '/').replace(/^\([^)/]*\)\//, '')
  const root = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const insensitive = isDrivePath(root)
  const same = (a: string, b: string): boolean => insensitive ? a.toLowerCase() === b.toLowerCase() : a === b
  let relative: string
  if (!fromUrl && root && value.length > root.length && same(value.slice(0, root.length), root) && value[root.length] === '/') relative = value.slice(root.length + 1)
  else if (isDrivePath(value)) return null
  else relative = value.replace(/^\/+/, '')
  relative = relative.replace(/^(\.\/)+/, '')
  const parts = relative.split('/')
  if (!relative || parts.some(part => part === '' || part === '.' || part === '..' || part === 'node_modules')) return null
  if (/[\u0000-\u001f:*?"<>|]/.test(relative)) return null
  return relative
}

/** Frames of a Chromium stack that are the person's code: `at Name (url:line:column)` or `at url:line:column`. */
export function firstProjectFrame(stack: string, rootPath: string): { file: string; line: number; column: number } | null {
  for (const line of stack.split('\n').slice(0, 40)) {
    const match = /\(?((?:https?|file|webpack-internal|webpack|rsc):\/\/[^\s)]+?):(\d+):(\d+)\)?\s*$/.exec(line)
    if (!match) continue
    if (/node_modules|\/@vite\/|\/@react-refresh|\/@id\/|react-dom|jsx-dev-runtime|jsx-runtime/.test(match[1])) continue
    const file = resolveSourceFile(match[1], rootPath)
    if (file) return { file, line: Number(match[2]), column: Number(match[3]) }
  }
  return null
}

const attribute = (probe: DesignSourceProbe, name: string): string | null => probe.attrs.find(([key]) => key === name)?.[1] ?? null
const positive = (value: string | null): number | null => { const n = value === null ? NaN : Number(value); return Number.isInteger(n) && n > 0 ? n : null }

/**
 * Where the element may be written, best first. Paths are inside the project by construction; the caller still checks
 * that each file exists before showing or sending it.
 */
export function designSourceCandidates(probe: DesignSourceProbe, rootPath: string): DesignGrabSource[] {
  const out: DesignGrabSource[] = []
  const component = probe.components[0] ?? probe.vue?.name ?? attribute(probe, 'data-sentry-component') ?? attribute(probe, 'data-component') ?? null
  const named = component && COMPONENT_NAME.test(component) ? component : null
  const add = (origin: DesignSourceOrigin, raw: string | null, line: number | null, column: number | null, approximate: boolean): void => {
    const file = raw ? resolveSourceFile(raw, rootPath) : null
    if (!file || out.some(item => item.file === file && item.line === line)) return
    out.push({ origin, file, line: line && line > 0 ? line : null, column: column && column > 0 ? column : null, component: named, approximate })
  }
  if (probe.react?.file) add('react', probe.react.file, probe.react.line, probe.react.column, false)
  const inspector = attribute(probe, 'data-inspector-relative-path')
  if (inspector) add('attribute', inspector, positive(attribute(probe, 'data-inspector-line')), positive(attribute(probe, 'data-inspector-column')), false)
  for (const name of ['data-oxe-source', 'data-source']) {
    const value = attribute(probe, name)
    const match = value ? /^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(value) : null
    if (match?.[1]) add('attribute', match[1], positive(match[2] ?? null), positive(match[3] ?? null), false)
  }
  const sourceFile = attribute(probe, 'data-source-file')
  if (sourceFile) add('attribute', sourceFile, positive(attribute(probe, 'data-source-line')), null, false)
  const locator = attribute(probe, 'data-locatorjs-id')
  if (locator) add('attribute', locator.split('::')[0], null, null, false)
  if (probe.astro?.file) { const [line, column] = (probe.astro.loc ?? '').split(':'); add('astro', probe.astro.file, positive(line ?? null), positive(column ?? null), false) }
  // Svelte numbers lines from 0 in some versions and from 1 in others: the line is shown as approximate.
  if (probe.svelte?.file) add('svelte', probe.svelte.file, probe.svelte.line, probe.svelte.column, true)
  if (probe.reactStack) { const frame = firstProjectFrame(probe.reactStack, rootPath); if (frame) add('react', frame.file, frame.line, frame.column, true) }
  if (probe.vue?.file) add('vue', probe.vue.file, null, null, false)
  return out.slice(0, 5)
}

/** `src/Button.tsx:42` (or just the file), as shown to the person and written to the agent. */
export function formatSourceLocation(source: Pick<DesignGrabSource, 'file' | 'line'>): string {
  return source.line ? `${source.file}:${source.line}` : source.file
}

export interface DesignSearchTerm { query: string; kind: 'id' | 'text' | 'class' }

/** Utility classes say nothing about where an element is written. */
const UTILITY_CLASS = /^(?:[a-z]{1,3}-|flex|grid|block|inline|hidden|relative|absolute|fixed|sticky|container|row|col|active|disabled|selected|open|closed|show|hide|is-|has-|sm:|md:|lg:|xl:|hover:|focus:|dark:)/

/**
 * When the framework says nothing (plain HTML, a production build), what to look for in the project to find the
 * element: its id, its own text, then its most specific class. At most three terms, each at least four characters.
 */
export function designSearchTerms(element: { id: string | null; text: string; classNames: string[]; html: string }): DesignSearchTerm[] {
  const terms: DesignSearchTerm[] = []
  if (element.id && element.id.length >= 3 && element.id.length <= 80) terms.push({ query: element.id, kind: 'id' })
  // Only the element's own short text: a container's text is its children's.
  const own = element.text.trim()
  if (own.length >= 4 && own.length <= 60 && !/</.test(own) && element.html.replace(/<[^>]*>/g, '').trim().length <= 80) terms.push({ query: own, kind: 'text' })
  const specific = element.classNames.filter(name => name.length >= 5 && name.length <= 60 && !UTILITY_CLASS.test(name) && !/^[a-z]+-\d+$/.test(name)).sort((a, b) => b.length - a.length)[0]
  if (specific) terms.push({ query: specific, kind: 'class' })
  return terms.slice(0, 3)
}
