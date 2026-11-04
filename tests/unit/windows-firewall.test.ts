// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
  FIREWALL_RULE_NAME, firewallCheckEnabled, inspectFirewall, quotePowerShellLiteral, repairCommand, repairFirewall, undoCommand, undoFirewall, type FirewallEnvironment
} from '../../electron/main/services/remote/windows-firewall'

/** 1.4.3 P1 · TECH LEAD's four rules: the rule is scoped (program, TCP port, Private only), elevation is UAC and never
 *  silent, the command is shown before it runs, and Undo removes only our rule by its fixed name. PowerShell is
 *  always stubbed: no test reads or changes the real firewall. */

const EXE = 'C:\\Program Files\\OXESpace\\OXESpace.exe'
const PORT = 47321

function stub(answers: Array<string | Error>): { env: FirewallEnvironment; scripts: string[] } {
  const scripts: string[] = []
  const env: FirewallEnvironment = {
    platform: 'win32', enabled: true, executablePath: EXE, systemRoot: 'C:\\Windows',
    runPowerShell: async script => {
      scripts.push(script)
      const next = answers.shift()
      if (next instanceof Error) throw next
      return next ?? ''
    }
  }
  return { env, scripts }
}

const inspected = (fields: Record<string, unknown>) => JSON.stringify({ allowRuleScopes: [], blockingRuleDetected: false, ownRulePresent: false, privateFirewallEnabled: true, networkCategory: 'Private', ...fields })
const decodeElevated = (outer: string): string => Buffer.from(/'-EncodedCommand', '([^']+)'/.exec(outer)![1], 'base64').toString('utf16le')

describe('rule 1: the rule is scoped to this program, TCP, the gateway port and the Private profile only', () => {
  test('the repair command names the program, TCP, the port, Private only, and blocks edge traversal', () => {
    const command = repairCommand(PORT, EXE)
    expect(command).toContain(`-Program ${quotePowerShellLiteral(EXE)}`)
    expect(command).toContain('-Protocol TCP')
    expect(command).toContain(`-LocalPort ${PORT}`)
    expect(command).toContain('-Profile Private')
    expect(command).not.toMatch(/Public|Domain|-Profile Any/)
    expect(command).toContain('-Direction Inbound -Action Allow')
    expect(command).toContain('-EdgeTraversalPolicy Block')
    expect(command).toContain(`-Name '${FIREWALL_RULE_NAME}'`)
  })

  test('the elevated script runs exactly the shown command, after removing only our own previous rule', async () => {
    const { env, scripts } = stub([JSON.stringify({ launched: true, exitCode: 0 }), inspected({ allowRuleScopes: [{ remoteAddresses: ['Any'] }], ownRulePresent: true })])
    await repairFirewall(PORT, '192.168.0.10', env)
    const elevated = decodeElevated(scripts[0])
    expect(elevated).toContain(repairCommand(PORT, EXE))
    expect(elevated).toContain(`Get-NetFirewallRule -Name '${FIREWALL_RULE_NAME}'`)
    // Never a rule the person or IT made: no Remove on anything but our fixed name, and no profile change.
    expect(elevated.match(/Remove-NetFirewallRule/g)).toHaveLength(1)
    expect(elevated).not.toMatch(/Set-NetConnectionProfile|Set-NetFirewallProfile|Action Block/)
  })

  test('a program path with quotes or spaces stays one literal', () => {
    expect(quotePowerShellLiteral("C:\\O'X\u2019E Space\\a.exe")).toBe("'C:\\O''X\u2019\u2019E Space\\a.exe'")
  })

  test('not on Windows, not packaged (a transient dev path), or no port: unsupported, and PowerShell never runs', async () => {
    for (const [patch, port] of [[{ platform: 'linux' as const }, PORT], [{ enabled: false }, PORT], [{}, null], [{}, 70_000]] as const) {
      const { env, scripts } = stub([])
      Object.assign(env, patch)
      expect(await inspectFirewall(port, undefined, env)).toEqual({ supported: false })
      expect(await repairFirewall(port, undefined, env)).toEqual({ ok: false, reason: 'unsupported' })
      expect(await undoFirewall(port, undefined, env)).toEqual({ ok: false, reason: 'unsupported' })
      expect(scripts).toEqual([])
    }
  })
})

describe('rule 2: elevation goes through UAC and is never silent', () => {
  test('repair and undo elevate with Start-Process -Verb RunAs, and nothing else changes the firewall', async () => {
    for (const run of [repairFirewall, undoFirewall]) {
      const { env, scripts } = stub([JSON.stringify({ launched: true, exitCode: 0 }), inspected({ allowRuleScopes: [{ remoteAddresses: ['LocalSubnet'] }] })])
      await run(PORT, undefined, env)
      expect(scripts[0]).toContain('-Verb RunAs')
      expect(scripts[0]).not.toMatch(/New-NetFirewallRule|Remove-NetFirewallRule/) // only inside the encoded, elevated child
      // The inspection after it reads only.
      expect(scripts[1]).not.toMatch(/New-NetFirewallRule|Remove-NetFirewallRule|Set-Net/)
    }
  })

  test('the inspection never elevates and never writes', async () => {
    const { env, scripts } = stub([inspected({})])
    await inspectFirewall(PORT, '192.168.0.10', env)
    expect(scripts[0]).not.toMatch(/RunAs|New-NetFirewallRule|Remove-NetFirewallRule|Set-Net/)
  })

  test('No at the UAC prompt (1223) is cancelled; a failing child is failed; neither inspects as success', async () => {
    expect(await repairFirewall(PORT, undefined, stub([JSON.stringify({ launched: false, nativeErrorCode: 1223 })]).env)).toEqual({ ok: false, reason: 'cancelled' })
    expect(await repairFirewall(PORT, undefined, stub([JSON.stringify({ launched: true, exitCode: 1 })]).env)).toEqual({ ok: false, reason: 'failed' })
    expect(await repairFirewall(PORT, undefined, stub([new Error('powershell missing')]).env)).toEqual({ ok: false, reason: 'failed' })
  })

  test('a repair counts only when a fresh inspection confirms the rule allows the port', async () => {
    const done = await repairFirewall(PORT, undefined, stub([JSON.stringify({ launched: true, exitCode: 0 }), inspected({ allowRuleScopes: [{ remoteAddresses: ['Any'] }], ownRulePresent: true })]).env)
    expect(done).toMatchObject({ ok: true, status: { ruleAllowed: true, ownRulePresent: true } })
    // Elevation reported success but a Block rule still wins: not verified.
    const blocked = await repairFirewall(PORT, undefined, stub([JSON.stringify({ launched: true, exitCode: 0 }), inspected({ allowRuleScopes: [{ remoteAddresses: ['Any'] }], blockingRuleDetected: true })]).env)
    expect(blocked).toMatchObject({ ok: false, reason: 'not-verified', status: { ruleAllowed: false, blockingRuleDetected: true } })
  })
})

describe('rule 3: the command is shown before it runs', () => {
  test('status carries the exact repair and undo commands, and those are what the elevated child runs', async () => {
    const { env } = stub([inspected({})])
    const status = await inspectFirewall(PORT, undefined, env)
    expect(status).toMatchObject({ supported: true, port: PORT, ruleName: 'OXESpace phone pairing', repairCommand: repairCommand(PORT, EXE), undoCommand: undoCommand() })
    const repair = stub([JSON.stringify({ launched: true, exitCode: 0 }), inspected({})])
    await repairFirewall(PORT, undefined, repair.env)
    expect(decodeElevated(repair.scripts[0])).toContain(status.supported ? status.repairCommand : '')
  })

  test('an inspection that fails still shows the commands and keeps Repair offered', async () => {
    const status = await inspectFirewall(PORT, undefined, stub([new Error('policy')]).env)
    expect(status).toMatchObject({ supported: true, inspectionAvailable: false, ruleAllowed: false, repairCommand: repairCommand(PORT, EXE) })
  })
})

describe('rule 4: Undo removes only our rule, by its fixed name', () => {
  test('the undo command and the elevated script remove exactly the fixed name, nothing else', async () => {
    expect(undoCommand()).toBe(`Remove-NetFirewallRule -Name '${FIREWALL_RULE_NAME}'`)
    const { env, scripts } = stub([JSON.stringify({ launched: true, exitCode: 0 }), inspected({ ownRulePresent: false })])
    expect(await undoFirewall(PORT, undefined, env)).toMatchObject({ ok: true, status: { ownRulePresent: false } })
    const elevated = decodeElevated(scripts[0])
    expect(elevated).toContain(`Get-NetFirewallRule -Name '${FIREWALL_RULE_NAME}'`)
    expect(elevated).not.toMatch(/-Program|Get-NetFirewallApplicationFilter|New-NetFirewallRule|-DisplayName/)
  })

  test('undo is verified: a rule still there afterwards is not-verified', async () => {
    expect(await undoFirewall(PORT, undefined, stub([JSON.stringify({ launched: true, exitCode: 0 }), inspected({ ownRulePresent: true })]).env))
      .toMatchObject({ ok: false, reason: 'not-verified' })
  })
})

describe('the CI test switch', () => {
  test('OXESPACE_E2E_FIREWALL_CHECK=1 enables an unpackaged run only; a packaged build ignores the switch either way', () => {
    expect(firewallCheckEnabled({}, false)).toBe(false)
    expect(firewallCheckEnabled({ OXESPACE_E2E_FIREWALL_CHECK: '1' }, false)).toBe(true)
    expect(firewallCheckEnabled({ OXESPACE_E2E_FIREWALL_CHECK: 'true' }, false)).toBe(false)
    // Packaged: always the real check, the switch changes nothing (set, unset or anything else).
    for (const env of [{}, { OXESPACE_E2E_FIREWALL_CHECK: '1' }, { OXESPACE_E2E_FIREWALL_CHECK: '0' }]) expect(firewallCheckEnabled(env, true)).toBe(true)
  })
})

describe('reading the state', () => {
  test('categories by name or number; an Allow rule reaches the phone only with Any or LocalSubnet scope', async () => {
    const read = async (fields: Record<string, unknown>) => inspectFirewall(PORT, '192.168.0.10', stub([inspected(fields)]).env)
    expect(await read({ networkCategory: 'Public' })).toMatchObject({ networkCategory: 'public', ruleAllowed: false })
    expect(await read({ networkCategory: 1, allowRuleScopes: [{ remoteAddresses: ['LocalSubnet'] }] })).toMatchObject({ networkCategory: 'private', ruleAllowed: true })
    expect(await read({ networkCategory: 'DomainAuthenticated', allowRuleScopes: [{ remoteAddresses: '*' }] })).toMatchObject({ networkCategory: 'domain', ruleAllowed: true })
    expect(await read({ networkCategory: 'Weird', allowRuleScopes: [{ remoteAddresses: ['10.0.0.5'] }] })).toMatchObject({ networkCategory: 'unknown', ruleAllowed: false })
    expect(await read({ privateFirewallEnabled: false })).toMatchObject({ privateFirewallEnabled: false })
  })

  test('the inspection names this program and port, and looks up the QR address\'s profile', async () => {
    const { env, scripts } = stub([inspected({})])
    await inspectFirewall(PORT, '192.168.0.10', env)
    expect(scripts[0]).toContain(`-Program ${quotePowerShellLiteral(EXE)}`)
    expect(scripts[0]).toContain(`'${PORT}'`)
    expect(scripts[0]).toContain("Get-NetIPAddress -IPAddress '192.168.0.10'")
    expect(scripts[0]).toContain('-PolicyStore ActiveStore')
  })
})
