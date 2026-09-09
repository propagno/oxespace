import { expect, test } from 'vitest'
import * as pty from 'node-pty'
import { agentMcpArguments } from '../../electron/main/services/agent-launch.service'
import { resolveExecutable } from '../../electron/main/services/terminal.service'
import { resolve } from 'node:path'

// Explicit opt-in: uses installed CLIs, but --help makes no model calls and
// changes no login/trust configuration. Exercises the actual OS PTY transport.
test.skipIf(!process.env.OXESPACE_TEST_AGENT_LAUNCH)('native Claude/Codex accept invocation MCP arguments through the PTY', async () => {
  for (const provider of ['claude', 'codex']) {
    const output = await new Promise<string>((resolveOutput, reject) => {
      const child = pty.spawn(resolveExecutable(provider), [...agentMcpArguments(provider, resolve('resources/mcp-bridge/oxespace-mcp.cjs')), '--help'], {
        cwd: process.cwd(), cols: 160, rows: 40, env: process.env as Record<string, string>
      })
      let text = ''
      const timeout = setTimeout(() => { child.kill(); reject(new Error(`${provider} did not exit`)) }, 20000)
      child.onData(data => { text += data })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolveOutput(text)
        else reject(new Error(`${provider} exited ${exitCode}: ${text.slice(-1500)}`))
      })
    })
    expect(output.toLowerCase()).toContain('usage')
    expect(output.toLowerCase()).not.toContain('invalid')
  }
}, 45000)
