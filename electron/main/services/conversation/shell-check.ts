/**
 * What Thread would do with a command line, using the real analysis and no saved rules.
 *
 * It exists for two readers: the packaged-app smoke test, which has to prove that the bash grammar
 * loaded from the shipped files and decides correctly, and anyone asking "would this be approved?".
 * Nothing is read from the project or the database, and nothing is executed.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ThreadShellCheck } from '../../../../shared/types/thread'
import { evaluatePermission } from './kernel/permission-policy'
import { shellParserReady, warmShellParser } from './shell-parse'

/** A project root that does not exist, so "inside the project" means "under this folder" and nothing else. */
const CHECK_ROOT = join(tmpdir(), 'oxe-shell-check')

export async function shellCheck(command: string): Promise<ThreadShellCheck> {
  await warmShellParser()
  const policy = evaluatePermission({ kind: 'approval', command }, CHECK_ROOT, [])
  return {
    parser: shellParserReady() ? 'bash-grammar' : 'text',
    decision: policy?.decision ?? 'ask',
    reasons: policy?.reasons ?? [],
    ...(policy?.level ? { level: policy.level } : {}),
    ...(policy?.warnings ? { warnings: policy.warnings } : {}),
    safeList: policy?.safeList === true
  }
}
