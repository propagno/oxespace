/**
 * A short orientation attached to a conversation's first message: which
 * project and branch, how it is built and tested, which instruction files the
 * CLI already loads, and which OXESpace code tools can answer questions
 * without reading whole files. Bounded, best effort (every source may fail on
 * its own) and switched off per project with `thread.brief: false` in oxe.yaml.
 *
 * Reads only package.json and existence of a few manifest files; never file
 * contents beyond that, never writes.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { loadRepoConfig } from '../repo-config/loader'
import { instructionLabel, instructionSources } from './instruction-sources'
import { runGit } from '../../utils/safe-git'

export const MAX_BRIEF_BYTES = 3 * 1024
const PACKAGE_LIMIT = 256 * 1024
const SCRIPT_KEYS = ['dev', 'build', 'test', 'lint', 'typecheck', 'check', 'format']
const MARKERS: Array<[string, string]> = [
  ['package.json', 'Node.js'], ['tsconfig.json', 'TypeScript'], ['Cargo.toml', 'Rust'], ['go.mod', 'Go'], ['pyproject.toml', 'Python'],
  ['requirements.txt', 'Python'], ['pom.xml', 'Java (Maven)'], ['build.gradle', 'Gradle'], ['build.gradle.kts', 'Gradle'], ['Gemfile', 'Ruby'],
  ['composer.json', 'PHP'], ['pubspec.yaml', 'Dart/Flutter'], ['Package.swift', 'Swift'], ['mix.exs', 'Elixir'], ['deno.json', 'Deno']
]

async function git(root: string, args: string[]): Promise<string> {
  const result = await runGit(root, args, { timeout: 3000, maxBuffer: 1024 * 1024 })
  return result.ok ? result.stdout : ''
}

function packageSummary(root: string): string[] {
  try {
    const path = join(root, 'package.json')
    if (statSync(path).size > PACKAGE_LIMIT) return []
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as { name?: unknown; scripts?: Record<string, unknown> }
    const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}
    const lines = SCRIPT_KEYS.filter(key => typeof scripts[key] === 'string').map(key => `npm run ${key}: ${String(scripts[key]).slice(0, 80)}`)
    return lines.length ? [`Scripts (package.json):`, ...lines.map(line => `  ${line}`)] : []
  } catch { return [] }
}

export async function projectBrief(rootPath: string, provider: 'claude' | 'codex'): Promise<string> {
  try { if (!statSync(rootPath).isDirectory()) return '' } catch { return '' }
  const config = await loadRepoConfig(rootPath)
  if (config?.thread?.brief === false) return ''
  const [branch, status] = await Promise.all([git(rootPath, ['rev-parse', '--abbrev-ref', 'HEAD']), git(rootPath, ['status', '--porcelain=v1', '--untracked-files=normal'])])
  const changes = status.split('\n').filter(Boolean).length
  const stack = [...new Set(MARKERS.filter(([file]) => existsSync(join(rootPath, file))).map(([, name]) => name))]
  const instructions = instructionSources(provider, rootPath).map(source => instructionLabel(source, rootPath))
  const lines = [
    `Project: ${basename(rootPath)} (${rootPath})`,
    ...(branch.trim() ? [`Branch: ${branch.trim()}${changes ? ` · ${changes} uncommitted change${changes === 1 ? '' : 's'}` : ' · clean'}`] : []),
    ...(stack.length ? [`Stack: ${stack.join(', ')}`] : []),
    ...packageSummary(rootPath),
    ...(instructions.length ? [`Instruction files you already loaded: ${instructions.slice(0, 8).join(', ')}`] : []),
    'OXESpace tools for this project: oxespace_hybrid_explore (source by meaning and structure, one call),',
    '  oxespace_code_search / oxespace_code_callers / oxespace_code_callees / oxespace_code_impact (code graph).',
    '  Prefer them over reading whole files when looking for where or how something works.'
  ]
  let body = lines.join('\n')
  while (Buffer.byteLength(body) > MAX_BRIEF_BYTES && lines.length > 1) { lines.splice(lines.length - 4, 1); body = lines.join('\n') }
  return body
}

/** The block appended to the agent's input; the stored message keeps the text as typed. */
export function briefBlock(brief: string): string {
  return brief ? `\n\n<oxespace-project-brief>\n${brief}\n</oxespace-project-brief>` : ''
}
