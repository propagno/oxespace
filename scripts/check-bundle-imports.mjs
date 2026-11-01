#!/usr/bin/env node
// Fails when a main-process bundle in out/main statically imports a package the installer does not ship.
//
// Tests and the packaged smoke run inside the checkout, where Node finds any package in the repository's
// node_modules by walking up from the app folder. An installed app has no such parent, so a static import of
// a devDependency (pg-cloudflare in 1.0.0) only breaks on users' machines. Run after `npm run build`.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join, relative } from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const shipped = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {})])
const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`), 'electron'])

const packageName = specifier => specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]

function files(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'mcp-bridge' || name === 'migrations' ? [] : files(path)
    return /\.(m?js|cjs)$/.test(name) ? [path] : []
  })
}

const outMain = join(root, 'out', 'main')
const problems = []
let scanned = 0
for (const file of files(outMain)) {
  const source = readFileSync(file, 'utf8')
  // Static ESM imports are evaluated when the module loads, so any missing one kills the whole bundle. The main
  // process is minified, so an import starts a line or follows a `;` and may have no spaces (`import{a as b}from"x"`).
  for (const match of source.matchAll(/(?:^|;)\s*import\s*(?:[^'";()]*?\s*from\s*)?["']([^"']+)["']/gm)) {
    scanned++
    const specifier = match[1]
    if (specifier.startsWith('.') || specifier.startsWith('/')) continue
    const name = packageName(specifier)
    if (builtins.has(specifier) || builtins.has(name) || shipped.has(name)) continue
    problems.push(`${relative(root, file)}: static import of "${specifier}", which is not in package.json dependencies or optionalDependencies`)
  }
}

// B13: the packaged app runs with the RunAsNode fuse off, so nothing in main may run the app binary as Node. Setting
// ELECTRON_RUN_AS_NODE (as a key or an assignment; deleting it is fine) or child_process.fork (which Electron does with
// process.execPath plus that variable) would start a second OXESpace instead. utilityProcess is the way to a Node child.
const runAsNode = []
const forkImport = /import\s*\{[^}]*\bfork\b[^}]*\}\s*from\s*["'](?:node:)?child_process["']/
const forkCall = /(?:require\(\s*["'](?:node:)?child_process["']\s*\)|\bchild_process)\s*\.\s*fork\s*\(/
for (const file of files(outMain)) {
  const source = readFileSync(file, 'utf8')
  if (/ELECTRON_RUN_AS_NODE["'`]?\s*(?::|=(?!=))/.test(source)) runAsNode.push(`${relative(root, file)}: sets ELECTRON_RUN_AS_NODE`)
  if (forkImport.test(source) || forkCall.test(source)) runAsNode.push(`${relative(root, file)}: uses child_process.fork`)
}
if (runAsNode.length) {
  console.error('Main bundles would run the app binary as Node, which the RunAsNode fuse forbids:\n' + runAsNode.map(line => `  - ${line}`).join('\n'))
  console.error('Spawn a native executable, or use utilityProcess.fork.')
  process.exit(1)
}

// Every bundle imports at least electron or a node builtin; finding none means the pattern no longer matches the output.
if (scanned === 0) {
  console.error('check-bundle-imports: no static import was found in out/main; the bundle format changed and this check would pass blindly.')
  process.exit(1)
}

if (problems.length) {
  console.error('Bundles import packages the installer does not ship:\n' + problems.map(line => `  - ${line}`).join('\n'))
  console.error('Bundle the package, alias it to a stub, or move it to dependencies.')
  process.exit(1)
}
console.log(`check-bundle-imports: ${files(outMain).length} bundles, ${scanned} static imports, every one shipped, built in or local`)
