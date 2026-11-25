// Frozen helper for the acceptance tests of 1.6.0 program 160-152 (Jira OXE-152). Written by the planner; the executor
// must not edit it. A raw button is the JSX tag `<button` written in a component: the src/ui primitives (Button,
// IconButton, SegmentedControl, Menu…) render the element themselves, so a component that uses them has none.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export const ROOT = process.cwd()
export const THREADS = 'src/components/Threads'

/** The source without comments, so a comment naming `<button>` is not a button. */
export function code(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/\s.*$/, ''))
    .join('\n')
}

/** How many raw `<button` tags a file writes. A file the F5 work removed or renamed counts as none. */
export function rawButtons(rel: string): number {
  if (!existsSync(join(ROOT, rel))) return 0
  return (code(rel).match(/<button\b/g) ?? []).length
}

/** Each listed file of a group with a raw button, and how many; empty when the group has none. */
export function offenders(files: readonly string[]): string[] {
  return files.map(file => `${THREADS}/${file}`).flatMap(rel => {
    const count = rawButtons(rel)
    return count ? [`${rel}: ${count}`] : []
  })
}

/** Every .ts and .tsx under src/components/Threads, tests excluded. */
export function threadsSources(dir: string = join(ROOT, THREADS)): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return threadsSources(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [relative(ROOT, path).split(sep).join('/')] : []
  })
}
