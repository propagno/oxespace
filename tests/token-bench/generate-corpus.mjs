#!/usr/bin/env node
/**
 * Generates a representative corpus for the token-reduction benchmark.
 *
 * These are SYNTHETIC-but-realistic paired samples meant to exercise the
 * methodology end-to-end. Replace any file under corpus/ with REAL captures
 * (actual terminal output, the files an agent really read, and real
 * verbose/caveman response pairs) to get production-grade numbers — the
 * benchmark reads every *.json in corpus/ regardless of origin.
 *
 * Each task models one agent turn:
 *   - terminalOutputRaw: noisy command output (ANSI + progress/duplicate spam)
 *   - baselineFiles:      everything the agent would read WITHOUT semantic search
 *   - semanticResultFiles: the relevant subset semantic search would surface
 *   - responseVerbose / responseCaveman: same answer, chatty vs terse
 *
 * Usage: node tests/token-bench/generate-corpus.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CORPUS_DIR = join(__dirname, 'corpus')
const ESC = ''
const E = String.fromCharCode(27) // ANSI escape (robust regardless of ESC literal above)
const color = (c, s) => `${E}[${c}m${s}${E}[0m`

// A noisy install/build log: ANSI colors, a carriage-return progress bar, and
// repeated lines — exactly the kind of spam RTK strips.
function noisyTerminal(pkg) {
  const progress = Array.from({ length: 12 }, (_, i) =>
    `\r${color('36', `[${'='.repeat(i)}${' '.repeat(11 - i)}] ${Math.round((i / 11) * 100)}%`)} fetching ${pkg}`
  ).join('')
  const warnings = Array.from({ length: 6 }, () =>
    color('33', `npm warn deprecated ${pkg}-core@1.2.3: use ${pkg}-core@2`)
  ).join('\n')
  return [
    color('32', `> ${pkg}@1.0.0 build`),
    color('32', `> tsc -p tsconfig.json && vite build`),
    '',
    progress,
    '',
    warnings,
    color('90', 'added 412 packages in 9s'),
    color('90', 'added 412 packages in 9s'),
    '',
    color('31', `src/${pkg}/index.ts:42:18 - error TS2345: Argument of type 'string | undefined'`),
    color('31', `  is not assignable to parameter of type 'string'.`),
    '',
    color('90', 'Found 1 error in 1 file.')
  ].join('\n')
}

function codeFile(name, lines) {
  const body = Array.from({ length: lines }, (_, i) =>
    `  const v${i} = compute_${name}(input.${name}_${i}, options); // step ${i} of ${name}`
  ).join('\n')
  return `// ${name}.ts — module handling ${name} concerns\nexport function ${name}(input, options) {\n${body}\n  return v0;\n}\n`
}

function verbose(topic) {
  return `Sure! I'd be happy to help you with that. After taking a careful look at the code you shared, ` +
    `it seems that the issue you're experiencing is most likely related to how the ${topic} module ` +
    `handles its input. Specifically, there appears to be a case where an undefined value can flow into ` +
    `a function that expects a string, which is what's triggering the TypeScript error you're seeing. ` +
    `To resolve this, I would recommend adding a guard clause at the top of the function so that you ` +
    `explicitly handle the undefined case before proceeding. Let me know if you'd like me to walk you ` +
    `through the change step by step, and I'm always glad to clarify anything that isn't clear!`
}

function caveman(topic) {
  return `Bug in ${topic} module. \`input.x\` can be undefined, passed to fn wanting string. ` +
    `Fix: guard at top.\n\`\`\`ts\nif (input.x == null) return\n\`\`\``
}

const TOPICS = ['auth', 'router', 'cache', 'parser', 'scheduler', 'storage', 'render', 'network']

mkdirSync(CORPUS_DIR, { recursive: true })
TOPICS.forEach((topic, i) => {
  const task = {
    id: `task-${String(i + 1).padStart(2, '0')}`,
    title: `Fix TS error in ${topic} module`,
    terminalOutputRaw: noisyTerminal(topic),
    // Without semantic: the agent reads the whole feature directory.
    baselineFiles: [
      codeFile(topic, 30),
      codeFile(`${topic}_utils`, 25),
      codeFile(`${topic}_types`, 18),
      codeFile(`${topic}_helpers`, 22)
    ],
    // With semantic: only the file actually relevant to the error is surfaced.
    semanticResultFiles: [codeFile(topic, 30)],
    responseVerbose: verbose(topic),
    responseCaveman: caveman(topic)
  }
  writeFileSync(join(CORPUS_DIR, `${task.id}.json`), JSON.stringify(task, null, 2))
})

process.stdout.write(`Generated ${TOPICS.length} corpus tasks in ${CORPUS_DIR}\n`)
