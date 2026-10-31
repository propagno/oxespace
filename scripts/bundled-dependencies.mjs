#!/usr/bin/env node
/**
 * Packages that are compiled into the app (the OxeQuery worker) instead of being
 * shipped as node_modules. They are devDependencies, so `npm sbom --omit dev`
 * and `npm audit --omit=dev` never see them. This script owns that blind spot:
 *
 *   node scripts/bundled-dependencies.mjs notices           write THIRD_PARTY_NOTICES.md
 *   node scripts/bundled-dependencies.mjs check             fail when the file is stale or a license is not allowed
 *   node scripts/bundled-dependencies.mjs audit [level]     npm audit restricted to the bundled closure
 *
 * The root list is `oxeBundledDependencies` in package.json.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const NOTICES = join(root, 'THIRD_PARTY_NOTICES.md')
const ALLOWED = /^(MIT|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|0BSD|BlueOak-1\.0\.0|CC0-1\.0|Unlicense|Python-2\.0)$/
const DENIED = /(^|[^L])GPL|AGPL|SSPL|BUSL|Commons-Clause/i
const LEVELS = ['info', 'low', 'moderate', 'high', 'critical']

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** Resolves `name` the way Node would from `from`, walking up node_modules directories. */
function locate(name, from) {
  let directory = from
  for (;;) {
    const candidate = join(directory, 'node_modules', name, 'package.json')
    if (existsSync(candidate)) return candidate
    const parent = join(directory, '..')
    if (parent === directory || directory === root && !existsSync(join(directory, 'node_modules'))) return null
    if (directory === root) return null
    directory = parent
  }
}

export function closure() {
  const manifest = readJson(join(root, 'package.json'))
  const roots = manifest.oxeBundledDependencies ?? []
  const seen = new Map()
  const queue = roots.map(name => ({ name, from: root, required: true }))
  const missing = []
  while (queue.length) {
    const { name, from, required } = queue.shift()
    const path = locate(name, from)
    if (!path) { if (required) missing.push(name); continue }
    const info = readJson(path)
    const key = `${info.name}@${info.version}`
    if (seen.has(key)) continue
    const directory = join(path, '..')
    seen.set(key, { name: info.name, version: info.version, license: normalizeLicense(info), repository: repositoryOf(info), directory })
    // Optional dependencies are listed as externals in the build; only hard dependencies are bundled.
    for (const dependency of Object.keys(info.dependencies ?? {})) queue.push({ name: dependency, from: directory, required: true })
  }
  return { packages: [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)), missing, roots }
}

function normalizeLicense(info) {
  const value = info.license ?? (Array.isArray(info.licenses) ? info.licenses.map(item => item.type).join(' OR ') : info.licenses?.type)
  return typeof value === 'string' ? value : value?.type ?? 'UNKNOWN'
}

function repositoryOf(info) {
  const value = typeof info.repository === 'string' ? info.repository : info.repository?.url ?? info.homepage ?? ''
  return String(value).replace(/^git\+/, '').replace(/\.git$/, '')
}

function licenseText(directory) {
  const file = readdirSync(directory).find(name => /^(licen[sc]e|copying|notice)(\..*)?$/i.test(name))
  return file ? readFileSync(join(directory, file), 'utf8').trim() : ''
}

function allowed(license) {
  if (DENIED.test(license)) return false
  const parts = license.replace(/[()]/g, '').split(/\s+(?:OR|AND)\s+/i).map(part => part.trim())
  return parts.some(part => ALLOWED.test(part))
}

/**
 * Projects OXESpace took design ideas and measured values from, without bundling their code. Listed with
 * their license so the credit ships with the app; the text is copied here because the project is not a
 * dependency and is not in node_modules.
 */
const ACKNOWLEDGEMENTS = [
  {
    name: 'Orca',
    source: 'https://github.com/stablyai/orca',
    use: 'Reference for the split-pane workspace model, the workspace jump in the command menu and the timing values of the agent hook events.',
    license: 'MIT',
    text: [
      'MIT License',
      '',
      'Copyright (c) 2026 Lovecast Inc.',
      '',
      'Permission is hereby granted, free of charge, to any person obtaining a copy',
      'of this software and associated documentation files (the "Software"), to deal',
      'in the Software without restriction, including without limitation the rights',
      'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
      'copies of the Software, and to permit persons to whom the Software is',
      'furnished to do so, subject to the following conditions:',
      '',
      'The above copyright notice and this permission notice shall be included in all',
      'copies or substantial portions of the Software.',
      '',
      'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
      'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
      'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
      'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
      'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
      'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
      'SOFTWARE.'
    ].join('\n')
  }
]

/**
 * Source copied into the repository instead of installed. Each folder under electron/main/vendor must be
 * listed here and carry its upstream LICENSE; `check` fails otherwise.
 */
const VENDOR_ROOT = join(root, 'electron', 'main', 'vendor')
const VENDORED = [
  {
    name: 'codegraph',
    folder: 'codegraph',
    source: 'https://github.com/colbymchenry/codegraph',
    license: 'MIT',
    use: 'Code graph indexing and search behind the code tools (electron/main/vendor/codegraph; origin and local changes in its ORIGIN.md).'
  }
]

function vendorProblems() {
  const folders = existsSync(VENDOR_ROOT) ? readdirSync(VENDOR_ROOT, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name) : []
  return [
    ...folders.filter(folder => !VENDORED.some(item => item.folder === folder)).map(folder => `electron/main/vendor/${folder} is not listed in VENDORED`),
    ...VENDORED.filter(item => !existsSync(join(VENDOR_ROOT, item.folder, 'LICENSE'))).map(item => `electron/main/vendor/${item.folder} has no LICENSE file`),
    ...VENDORED.filter(item => !allowed(item.license)).map(item => `electron/main/vendor/${item.folder} has license "${item.license}", which is not allowed`)
  ]
}

export function render(packages) {
  const lines = [
    '# Third-party notices',
    '',
    'OXESpace bundles the following open-source packages into its OxeQuery database worker.',
    'They are listed here because they are compiled into the application rather than shipped as separate files.',
    'Regenerate with `npm run notices:generate`.',
    ''
  ]
  for (const item of packages) {
    lines.push(`## ${item.name} ${item.version}`, '', `- License: ${item.license}`)
    if (item.repository) lines.push(`- Source: ${item.repository}`)
    const text = licenseText(item.directory)
    if (text) lines.push('', '```text', text, '```')
    lines.push('')
  }
  lines.push('# Vendored source', '', 'OXESpace includes the source of these projects, copied and modified in its repository.', '')
  for (const item of VENDORED) {
    lines.push(`## ${item.name}`, '', `- License: ${item.license}`, `- Source: ${item.source}`, `- Used for: ${item.use}`, '', '```text', readFileSync(join(VENDOR_ROOT, item.folder, 'LICENSE'), 'utf8').replace(/\r\n/g, '\n').trim(), '```', '')
  }
  lines.push('# Acknowledgements', '', 'OXESpace does not bundle code from these projects, but took design ideas or values from them.', '')
  for (const item of ACKNOWLEDGEMENTS) {
    lines.push(`## ${item.name}`, '', `- License: ${item.license}`, `- Source: ${item.source}`, `- Used for: ${item.use}`, '', '```text', item.text, '```', '')
  }
  return `${lines.join('\n')}\n`
}

function main() {
  const [command = 'check', argument] = process.argv.slice(2)
  const { packages, missing, roots } = closure()
  if (missing.length) { console.error(`[notices] not installed: ${missing.join(', ')}. Run npm ci first.`); process.exit(1) }
  if (!roots.length) { console.error('[notices] package.json has no oxeBundledDependencies'); process.exit(1) }

  if (command === 'notices') {
    writeFileSync(NOTICES, render(packages))
    console.log(`[notices] wrote ${packages.length} packages to THIRD_PARTY_NOTICES.md`)
    return
  }

  if (command === 'check') {
    const vendor = vendorProblems()
    if (vendor.length) { for (const problem of vendor) console.error(`[notices] ${problem}`); process.exit(1) }
    const blocked = packages.filter(item => !allowed(item.license))
    if (blocked.length) {
      for (const item of blocked) console.error(`[notices] ${item.name}@${item.version} has license "${item.license}", which is not allowed in the bundle`)
      process.exit(1)
    }
    const current = existsSync(NOTICES) ? readFileSync(NOTICES, 'utf8').replace(/\r\n/g, '\n') : ''
    if (current !== render(packages)) {
      console.error('[notices] THIRD_PARTY_NOTICES.md is out of date. Run `npm run notices:generate` and commit it.')
      process.exit(1)
    }
    console.log(`[notices] ${packages.length} bundled packages, all licenses allowed, notices up to date`)
    return
  }

  if (command === 'audit') {
    const threshold = LEVELS.indexOf(argument ?? 'moderate')
    if (threshold < 0) { console.error(`[audit] unknown level ${argument}`); process.exit(1) }
    let raw
    try { raw = execFileSync('npm', ['audit', '--json', '--package-lock-only'], { encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 32 * 1024 * 1024 }) }
    catch (error) { raw = error.stdout?.toString() ?? '' } // npm exits non-zero when it finds something
    const report = JSON.parse(raw || '{}')
    const names = new Set(packages.map(item => item.name))
    const findings = Object.values(report.vulnerabilities ?? {}).filter(item => names.has(item.name) && LEVELS.indexOf(item.severity) >= threshold)
    for (const item of findings) console.error(`[audit] ${item.name}: ${item.severity} — ${(item.via ?? []).map(via => via.title ?? via).join('; ')}`)
    if (findings.length) process.exit(1)
    console.log(`[audit] no ${LEVELS[threshold]}+ advisories in ${packages.length} bundled packages`)
    return
  }

  console.error(`Unknown command ${command}`)
  process.exit(1)
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) main()
