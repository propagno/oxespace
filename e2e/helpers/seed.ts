import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FIXED_DATE = '2026-10-14T12:00:00Z'

/**
 * Creates a git repository whose history is byte-for-byte reproducible: fixed author,
 * fixed commit dates, fixed branch names. Panels that print hashes or dates therefore
 * render the same text on every run.
 */
export function seedGitRepo(repo: string, options: { withBranchChanges: boolean }): void {
  mkdirSync(join(repo, 'src'), { recursive: true })
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'E2E', GIT_AUTHOR_EMAIL: 'e2e@example.com', GIT_AUTHOR_DATE: FIXED_DATE,
    GIT_COMMITTER_NAME: 'E2E', GIT_COMMITTER_EMAIL: 'e2e@example.com', GIT_COMMITTER_DATE: FIXED_DATE
  }
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd: repo, env, stdio: 'ignore' }) }
  const lines = (changed?: number): string => Array.from({ length: 60 }, (_, i) => (i === changed ? `line ${i + 1} CHANGED` : `line ${i + 1}`)).join('\n') + '\n'

  git('init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'src', 'app.ts'), lines())
  writeFileSync(join(repo, 'README.md'), '# repo\n\nA fixture project for visual tests.\n')
  git('add', '.')
  git('commit', '-qm', 'base')
  if (!options.withBranchChanges) return

  git('checkout', '-qb', 'feature/changes')
  writeFileSync(join(repo, 'src', 'app.ts'), lines(30))
  writeFileSync(join(repo, 'docs.md'), 'new file\n')
  git('add', '.')
  git('commit', '-qm', 'feature')
}
