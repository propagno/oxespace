/**
 * A60 (1.5.0, F4): the processes behind PullRequestProvider. gh never starts here: it goes through GhExec.ghCommand
 * (gh-exec.ts), which reads the repository's config first, refuses what a person's network git would refuse and gives
 * gh safe-git's environment with the repository's commands neutralized (SECURITY S4-1, #387 M2). Only az runs here,
 * with ghEnv(): on Windows its MSI python, located with where.exe, without a shell.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { ghEnv } from '../../utils/safe-git'
import { GhExec } from '../github/gh-exec'
import type { PrCliRunner } from './pr-provider'

type CliReply = Awaited<ReturnType<PrCliRunner>>

const CLI_TIMEOUT = 60_000
const OUTPUT_CAP = 8 * 1024 * 1024

function spawnCli(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<CliReply> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: CliReply): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already gone */ }
      finish({ status: null, stdout, stderr: stderr || `${command} timed out.` })
    }, CLI_TIMEOUT)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { if (stdout.length < OUTPUT_CAP) stdout += chunk })
    child.stderr?.on('data', (chunk: string) => { if (stderr.length < OUTPUT_CAP) stderr += chunk })
    child.on('error', (error: NodeJS.ErrnoException) => finish(error.code === 'ENOENT'
      ? { status: null, stdout: '', stderr: '', missing: true }
      : { status: null, stdout, stderr: error.message }))
    child.on('close', (code) => finish({ status: code, stdout, stderr }))
  })
}

/**
 * On Windows az is az.cmd, which only a shell runs. Its MSI install runs `<CLI2>\python.exe -IBm azure.cli`, so that is
 * what runs here, without a shell; any other install reads as missing.
 */
async function azureOnWindows(cwd: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const where = await spawnCli('where.exe', ['az'], cwd, env)
  if (where.status !== 0) return null
  const script = where.stdout.split(/\r?\n/).map(line => line.trim()).find(line => /[\\/]wbin[\\/]az\.cmd$/i.test(line))
  return script ? join(dirname(dirname(script)), 'python.exe') : null
}

/** The app's runner: az here, gh through GhExec (its rules, its environment). */
export function createPrCliRunner(exec = new GhExec()): PrCliRunner {
  return async (command, args, cwd) => {
    if (command !== 'az') return exec.ghCommand(args, cwd, CLI_TIMEOUT)
    const env = ghEnv()
    if (process.platform !== 'win32') return spawnCli('az', args, cwd, env)
    const python = await azureOnWindows(cwd, env)
    if (!python) return { status: null, stdout: '', stderr: '', missing: true }
    return spawnCli(python, ['-IBm', 'azure.cli', ...args], cwd, { ...env, AZ_INSTALLER: 'MSI' })
  }
}
