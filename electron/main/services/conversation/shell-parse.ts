/**
 * Reads a shell command line with the bash grammar instead of splitting its text.
 *
 * The text splitter in `shell-command-rules.ts` knows quotes and operators; this knows the
 * language, so groups, loops, here-documents and commands inside `$( … )` are seen for what
 * they are. Adapted from VS Code's tree-sitter command parser (microsoft/vscode, MIT licence,
 * Copyright (c) Microsoft Corporation): `treeSitterCommandParser.ts`.
 *
 * It fails closed. A tree with a syntax error, a command whose name is computed
 * (`$cmd args`), a bare assignment, `export`/`declare`, or a function definition is
 * `unanalysable`, and the caller asks instead of guessing. Until the grammar has loaded,
 * `parseShell` returns null and the caller keeps using the text splitter.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Language, Parser, type Node } from 'web-tree-sitter'

export interface ParsedShell {
  /** Source text of every simple command, at any depth, in reading order. */
  commands: string[]
  /** Targets of output redirects (`> f`, `>> f`, `&> f`), without file-descriptor duplication. */
  writes: string[]
  /** Something that cannot be judged from the text alone. */
  unanalysable: boolean
}

/** A line longer than this is not parsed: the request text is clipped well below it, and a parse must stay quick. */
const MAX_LINE = 16384
const COMPUTED_NAME = /[$`]|^\(|^<\(|^>\(/
const OPAQUE = new Set(['variable_assignment', 'declaration_command', 'function_definition', 'unset_command'])

let parser: Parser | null = null
let loading: Promise<boolean> | null = null

/** Directories that may hold the grammar, most specific first: the packaged app, then a source checkout. */
function candidates(file: string, runtime: boolean): string[] {
  const dirs = [process.env.CODEGRAPH_ASSET_DIR, join(process.cwd(), 'out', 'main')].filter(Boolean) as string[]
  const fromAssets = dirs.map((dir) => (runtime ? join(dir, file) : join(dir, 'wasm', file)))
  const modulePath = runtime ? ['node_modules', 'web-tree-sitter', file] : ['node_modules', 'tree-sitter-wasms', 'out', file]
  // A packaged app keeps these modules unpacked next to the asar (electron-builder.yml), as real files.
  const resources = (process as { resourcesPath?: string }).resourcesPath
  const unpacked = resources ? [join(resources, 'app.asar.unpacked', ...modulePath)] : []
  return [...fromAssets, ...unpacked, join(process.cwd(), ...modulePath)]
}

const firstExisting = (paths: string[]): string | undefined => paths.find((path) => existsSync(path))

/** Loads the runtime and the bash grammar once. Resolves false, and leaves the text splitter in charge, if either is missing. */
export function warmShellParser(): Promise<boolean> {
  loading ??= (async () => {
    try {
      const runtime = firstExisting(candidates('tree-sitter.wasm', true))
      const grammar = firstExisting(candidates('tree-sitter-bash.wasm', false))
      if (!runtime || !grammar) return false
      await Parser.init({ locateFile: (file: string) => (file === 'tree-sitter.wasm' ? runtime : join(runtime, '..', file)) })
      const next = new Parser()
      next.setLanguage(await Language.load(grammar))
      parser = next
      return true
    } catch {
      parser = null
      return false
    }
  })()
  return loading
}

export const shellParserReady = (): boolean => parser !== null

/** Test hook: behave as if the grammar could not be loaded. */
export function forgetShellParserForTests(): void { parser = null; loading = null }

function visit(node: Node, out: ParsedShell): void {
  if (OPAQUE.has(node.type)) { out.unanalysable = true; return }
  if (node.type === 'command') {
    const name = node.childForFieldName('name')
    if (!name || COMPUTED_NAME.test(name.text)) out.unanalysable = true
    else out.commands.push(node.text)
  } else if (node.type === 'file_redirect') {
    // The operator is not a node of its own, so read it from the text: `>`, `>>`, `&>`, `&>>`, `>|`, `>&`, with an optional descriptor.
    const operator = node.text.match(/^\s*\d*(>>?|&>>?|>\|)(&?)/)
    const target = node.childForFieldName('destination')?.text ?? ''
    // `2>&1` and `>&2` duplicate a descriptor; `<` reads. Neither writes a file.
    if (operator && !(operator[2] === '&' && /^\d+-?$/.test(target))) out.writes.push(target)
  }
  for (const child of node.namedChildren) if (child) visit(child, out)
}

/** The simple commands and file writes of a line, or null when the grammar is not loaded. */
export function parseShell(line: string): ParsedShell | null {
  if (!parser) return null
  if (line.length > MAX_LINE) return { commands: [], writes: [], unanalysable: true }
  const tree = parser.parse(line)
  const out: ParsedShell = { commands: [], writes: [], unanalysable: false }
  if (!tree || tree.rootNode.hasError) return { ...out, unanalysable: true }
  visit(tree.rootNode, out)
  tree.delete()
  if (out.commands.length === 0 && !out.unanalysable) out.unanalysable = true
  return out
}
