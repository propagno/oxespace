/**
 * What other services already learned this run, for the diagnostics panel (B8.3): a CLI's version and whether an
 * account is signed in. Nothing here starts a process or reads a file; a value is only known once its owner noted
 * it. No account name, e-mail or path is kept: a provider id, a yes/no, a version string.
 */
const cliVersions = new Map<string, string>()
const accounts = new Map<string, boolean>()

const ID = /^[a-z][a-z0-9-]{0,31}$/
const VERSION = /^\d[\da-zA-Z.+-]{0,40}$/

export function noteCliVersion(id: string, version: string): void {
  if (ID.test(id) && VERSION.test(version)) cliVersions.set(id, version)
}

export function knownCliVersion(id: string): string | undefined { return cliVersions.get(id) }

export function noteAccount(provider: string, signedIn: boolean): void {
  if (ID.test(provider)) accounts.set(provider, signedIn)
}

export function knownAccounts(): Array<{ provider: string; signedIn: boolean }> {
  return [...accounts].sort(([a], [b]) => a.localeCompare(b)).map(([provider, signedIn]) => ({ provider, signedIn }))
}

/** Tests only. */
export function resetDiagnosticFacts(): void { cliVersions.clear(); accounts.clear() }
