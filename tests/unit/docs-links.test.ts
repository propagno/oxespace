// @vitest-environment node
/**
 * Relative links in the README and the documentation must point at files that exist. A broken link
 * in the first page a user reads is the cheapest kind of defect to prevent. Only the target file is
 * checked, not the #anchor, and external links are left alone.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const rel = (file: string): string => relative(ROOT, file).split(sep).join('/')

function markdownIn(dir: string, depth: number): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return depth > 0 && !['node_modules', 'assets', '.cache'].includes(name) ? markdownIn(path, depth - 1) : []
    return name.endsWith('.md') ? [path] : []
  })
}

// README and SECURITY at the root, plus everything under docs/ except two kinds of dated record:
// the working plans (docs/plans, which mention files that do not exist yet) and the audits
// (docs/audits, which describe the code as it was on that day and link to files since removed;
// rewriting those links would falsify the record).
const SKIPPED = ['docs/plans/', 'docs/audits/']
const files = [
  join(ROOT, 'README.md'),
  ...(existsSync(join(ROOT, 'SECURITY.md')) ? [join(ROOT, 'SECURITY.md')] : []),
  ...markdownIn(join(ROOT, 'docs'), 3).filter(file => !SKIPPED.some(prefix => rel(file).startsWith(prefix)))
]

const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

/** Links outside code fences and inline code. */
function linksIn(markdown: string): string[] {
  const text = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  return [...text.matchAll(LINK)].map(match => match[1])
}

describe('documentation links', () => {
  test('finds the documents it is supposed to check', () => {
    const names = files.map(rel)
    expect(names).toContain('README.md')
    expect(names).toContain('docs/PRIVACY.md')
    expect(names).toContain('docs/PLATFORM_SPEC.md')
  })

  test('every relative link points at a file that exists', () => {
    const broken: string[] = []
    for (const file of files) {
      for (const link of linksIn(readFileSync(file, 'utf8'))) {
        if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(link)) continue
        const target = decodeURIComponent(link.split('#')[0].split('?')[0])
        if (!target) continue
        if (!existsSync(resolve(dirname(file), target))) broken.push(`${rel(file)} -> ${link}`)
      }
    }
    expect(broken).toEqual([])
  })

  test('the extractor ignores code and external links and finds a real one', () => {
    const fence = '```'
    const sample = `See [guide](docs/GUIDE.md#top), [site](https://example.com/x.md), \`[not](a.md)\`\n${fence}\n[fenced](b.md)\n${fence}\n`
    expect(linksIn(sample)).toEqual(['docs/GUIDE.md#top', 'https://example.com/x.md'])
  })
})
