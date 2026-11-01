// B13 (BE-M-02): what "runs the app binary as Node" looks like in source or in a built bundle. The packaged app has
// the RunAsNode fuse off, so setting ELECTRON_RUN_AS_NODE or calling child_process.fork (which Electron runs as
// process.execPath plus that variable) would start a second OXESpace instead. Shared by scripts/check-bundle-imports.mjs
// (the built out/main) and tests/run-as-node-guard.test.ts (the sources). utilityProcess is the way to a Node child.

const CHILD_PROCESS = String.raw`["'\x60](?:node:)?child_process["'\x60]`

/** `X: …`, `X = …`, `["X"]: …` or `["X"] = …`: a key or an assignment. Comparing (`===`) or deleting is fine. */
const SETS_RUN_AS_NODE = /ELECTRON_RUN_AS_NODE["'`]?\s*\]?\s*(?::|=(?!=))/

const FORK_PATTERNS = [
  // import { fork } / import { fork as x } from 'child_process'
  new RegExp(String.raw`import\s*(?:type\s+)?(?:\w+\s*,\s*)?\{[^}]*\bfork\b[^}]*\}\s*from\s*` + CHILD_PROCESS),
  // const { fork } = require('child_process') / await import('child_process')
  new RegExp(String.raw`\{[^}]*\bfork\b[^}]*\}\s*=\s*(?:await\s+)?(?:require|import)\s*\(\s*` + CHILD_PROCESS + String.raw`\s*\)`),
  // require('child_process').fork(…) / (await import('child_process')).fork(…)
  new RegExp(String.raw`(?:require|import)\s*\(\s*` + CHILD_PROCESS + String.raw`\s*\)\s*\)?\s*\.\s*fork\b`),
  // child_process.fork(…), with the module bound under its own name
  /\bchild_process\s*\.\s*fork\s*\(/
]

/** Names a child_process module is bound to: namespace, default or a dynamic import/require kept in a variable. */
const BINDINGS = [
  new RegExp(String.raw`import\s*\*\s*as\s+([\w$]+)\s*from\s*` + CHILD_PROCESS, 'g'),
  new RegExp(String.raw`import\s+([\w$]+)\s*(?:,\s*\{[^}]*\})?\s*from\s*` + CHILD_PROCESS, 'g'),
  new RegExp(String.raw`(?:const|let|var)\s+([\w$]+)\s*=\s*(?:await\s+)?(?:require|import)\s*\(\s*` + CHILD_PROCESS + String.raw`\s*\)`, 'g')
]

const escape = (name) => name.replace(/[$]/g, '\\$&')

/** Every way `text` runs the app binary as Node; an empty list when it does not. */
export function runAsNodeProblems(text) {
  const problems = []
  if (SETS_RUN_AS_NODE.test(text)) problems.push('sets ELECTRON_RUN_AS_NODE')
  let fork = FORK_PATTERNS.some(pattern => pattern.test(text))
  if (!fork) {
    for (const pattern of BINDINGS) {
      for (const match of text.matchAll(pattern)) {
        if (new RegExp(String.raw`(?:^|[^\w$.])` + escape(match[1]) + String.raw`\s*\.\s*fork\s*\(`).test(text)) fork = true
      }
    }
  }
  if (fork) problems.push('uses child_process.fork')
  return problems
}
