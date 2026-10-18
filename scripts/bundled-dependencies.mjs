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
    let raw = ''
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
