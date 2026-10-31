#!/usr/bin/env node
/**
 * S0.1 · The key set of a hot file, so a split can prove it renamed nothing.
 *
 *   node scripts/hot-file-keys.mjs messages <path to messages.ts>
 *
 * prints every C3 message code with the name, optionality and type of each parameter, read by the TypeScript checker
 * from `MessageParams` (wherever its domains live). The fixture in tests/fixtures/hot-files/ was printed from origin/main
 * before the split (`git show origin/main:shared/messages.ts > <tmp>/messages.ts`), and tests/hot-file-keys.test.ts
 * compares the split files with it.
 */
import ts from 'typescript'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `{ [code]: { [param]: '<type>' | '<type>?' } }`, sorted by code and parameter. */
export function messageShape(file) {
  const path = resolve(file)
  const program = ts.createProgram([path], { strict: true, noEmit: true, skipLibCheck: true, types: [], target: ts.ScriptTarget.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext })
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(path)
  if (!source) throw new Error(`cannot read ${file}`)
  const symbol = checker.getSymbolAtLocation(source)?.exports?.get('MessageParams')
  if (!symbol) throw new Error(`${file} exports no MessageParams`)
  const shape = {}
  for (const code of checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol)).sort((a, b) => a.name.localeCompare(b.name))) {
    const params = checker.getTypeOfSymbol(code)
    const entry = {}
    for (const param of checker.getPropertiesOfType(params).sort((a, b) => a.name.localeCompare(b.name))) {
      const optional = (param.flags & ts.SymbolFlags.Optional) !== 0
      entry[param.name] = checker.typeToString(checker.getTypeOfSymbol(param)) + (optional ? '?' : '')
    }
    shape[code.name] = entry
  }
  return shape
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [kind, file] = process.argv.slice(2)
  if (kind !== 'messages' || !file) {
    console.error('usage: node scripts/hot-file-keys.mjs messages <messages.ts>')
    process.exit(2)
  }
  process.stdout.write(`${JSON.stringify(messageShape(file), null, 2)}\n`)
}
