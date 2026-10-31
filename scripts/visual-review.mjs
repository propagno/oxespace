/**
 * Side-by-side review of a visual comparison run. Playwright writes, for each surface that differs, the baseline
 * (`*-expected.png`), what the run drew (`*-actual.png`) and the difference (`*-diff.png`) under test-results/. This
 * builds one HTML page with the three next to each other, so a person can decide per surface: a regression to fix,
 * or a change to accept by regenerating the baselines (visual-baselines.yml).
 *
 *   node scripts/visual-review.mjs [results-dir] [out.html]
 *
 * Defaults: test-results and test-results/visual-review.html. Images are referenced relative to the page, so the
 * folder can be downloaded as an artifact and opened as is. Prints how many surfaces differ; exits 0 either way.
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const resultsDir = process.argv[2] ?? 'test-results'
const outFile = process.argv[3] ?? join(resultsDir, 'visual-review.html')

const files = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? files(path) : [path]
})

/** One entry per surface that has an actual image, with whichever of the three exist. */
export function collect(dir) {
  const all = files(dir).filter(path => path.endsWith('.png'))
  return all.filter(path => path.endsWith('-actual.png')).map(actual => {
    const base = actual.slice(0, -'-actual.png'.length)
    const pick = suffix => all.find(path => path === `${base}${suffix}`)
    // The image's own name (empty-light-desktop-pt-BR); the folder is Playwright's slug of the test title.
    return { name: base.split(sep).at(-1), actual, expected: pick('-expected.png'), diff: pick('-diff.png') }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

const escape = text => text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])

export function page(entries, from) {
  const href = path => path ? escape(relative(from, path).split(sep).join('/')) : ''
  const cell = (label, path) => `<figure><figcaption>${label}</figcaption>${path ? `<a href="${href(path)}"><img src="${href(path)}" alt="${label}" loading="lazy"></a>` : '<p>none: a new surface without a baseline</p>'}</figure>`
  const body = entries.length
    ? entries.map(entry => `<section><h2>${escape(entry.name)}</h2><div class="row">${cell('Baseline', entry.expected)}${cell('This run', entry.actual)}${cell('Difference', entry.diff)}</div></section>`).join('\n')
    : '<p>No surface differs from its baseline.</p>'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Visual review · ${entries.length} differ</title>
<style>
body { margin: 24px; font: 14px system-ui, sans-serif; background: #f6f7f6; color: #1b211d; }
@media (prefers-color-scheme: dark) { body { background: #121513; color: #e3e8e4; } }
h1 { font-size: 20px; } h2 { margin: 32px 0 8px; font-size: 15px; }
.row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
figure { margin: 0; } figcaption { margin-bottom: 4px; font-size: 12px; opacity: .7; }
img { display: block; width: 100%; height: auto; border: 1px solid #8884; }
</style></head><body><h1>Visual review: ${entries.length} surface${entries.length === 1 ? '' : 's'} differ</h1>
<p>Fix a regression in the code, or accept an intended change by regenerating the baselines (visual-baselines.yml) and reviewing them.</p>
${body}</body></html>\n`
}

// Run as a script; imported (by its test) it only exports.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const entries = (() => { try { return collect(resultsDir) } catch { return [] } })()
  writeFileSync(outFile, page(entries, dirname(outFile)))
  console.log(`[visual-review] ${entries.length} surface(s) differ → ${outFile}`)
}
