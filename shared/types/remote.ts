import type { MainMessage } from '../messages'

/**
 * Settings › Devices: the desktop side of the remote gateway (B9). The phone side speaks the C5 protocol in
 * `shared/remote/protocol.ts`; these are the window's channels. Every action here is the person's own: none of them is an
 * MCP tool, and the main process accepts them only from the app's window.
 */

/** Ports below this are refused when the person picks one (`remote.port.privileged`). */
export const REMOTE_MIN_PORT = 1024

/** The name phones see until the person chooses one; never the host name. */
export const REMOTE_DEFAULT_DESKTOP_NAME = 'OXESpace'
export const REMOTE_MAX_DESKTOP_NAME_LENGTH = 32

export interface RemoteGatewayStatus {
  enabled: boolean
  /** What phones see in `hello` and the QR: `REMOTE_DEFAULT_DESKTOP_NAME` or the person's choice. */
  desktopName: string
  /** Where it listens: private interfaces only (RFC 1918, link-local, ULA). `null` while off or failing. */
  listening: { addresses: string[]; port: number } | null
  /** SHA-256 of the certificate DER, 64 lowercase hex characters, once a certificate exists. */
  fingerprint: string | null
  devices: number
  maxDevices: number
  /** Panes the person allowed the phone to type into. Empty when the app starts. */
  phoneWritePanes: string[]
  /** CR-34: panes kept off the phone entirely, sorted; persisted per pane. Every pane is shown by default. */
  phoneHiddenPanes?: string[]
  /** Why it is not listening (port in use, firewall, certificate…), as a code the window translates. */
  error?: MainMessage
  /**
   * True once the gateway has really listened on this profile, and never false again: the window explains the system
   * firewall's question before the first time only.
   */
  listenedBefore: boolean
  /**
   * Windows' network profile of the interface the QR names, when it could be read (Windows only, read only). On
   * `public` the system firewall drops a phone's request unless a rule allows OXESpace, so pairing never arrives.
   */
  network?: { interfaceName: string; category: RemoteNetworkCategory }
  /** The pairing question waiting for the person, so a window that opens or reloads can show it. */
  pendingPairing?: RemotePairingPrompt
}

/** Windows' NetworkCategory of a connection profile. */
export type RemoteNetworkCategory = 'public' | 'private' | 'domain'

/** A paired phone. No address and no key. */
export interface RemoteDevice {
  deviceId: string
  name: string
  pairedAt: number
  lastSeenAt: number | null
  connected: boolean
}

/**
 * A phone asking to pair. The window asks "Pair <deviceName>? Check the code <verification> on the phone"; the
 * request is answered only from the app's window, never from a notification or a global shortcut. Unanswered by
 * `expiresAt`, the phone is told `pairing-refused`.
 */
export interface RemotePairingPrompt {
  promptId: string
  deviceName: string
  /** `pairingVerification` of the phone's key: the same 6 characters the phone shows. */
  verification: string
  expiresAt: number
}

/** A pairing code on screen: the window draws the QR from `uri` and shows the code for typing it in. */
export interface RemotePairingOffer {
  uri: string
  expiresAt: number
}

/**
 * Why a phone's pairing attempt failed, as `remote.pairing.failed` carries it: a wrong, reused or forged code or request
 * (`invalid`), a code or question that ran out of time (`expired`), the person said no or cancelled on this desktop
 * (`refused`), the device limit (`limit`), the phone hung up while the question was on screen (`peer-closed`), the
 * phone gave itself a name only the app may speak as (`reserved-name`; `reservedNameIn` in shared/approval-rules.ts),
 * or the code expired without any phone reaching this computer (`no-contact`: a firewall, a Public network profile,
 * or another network).
 */
export const REMOTE_PAIRING_FAILURE_REASONS = ['invalid', 'expired', 'refused', 'limit', 'peer-closed', 'reserved-name', 'no-contact'] as const
export type RemotePairingFailureReason = typeof REMOTE_PAIRING_FAILURE_REASONS[number]

/** 1.4.3 P1: Windows' network category of the interface the QR names, as the firewall check reads it. */
export type RemoteFirewallNetwork = 'public' | 'private' | 'domain' | 'unknown'

/**
 * 1.4.3 P1 · Whether Windows lets a phone reach the gateway. Read only; `supported: false` off Windows, in a development
 * build, or while the gateway is off. The two commands are exactly what Repair and Undo run, for the window to show
 * before the person confirms.
 */
export type RemoteFirewallStatus =
  | { supported: false }
  | {
    supported: true
    port: number
    /** The rule's display name in Windows Firewall ("OXESpace phone pairing"). */
    ruleName: string
    repairCommand: string
    undoCommand: string
    /** False when PowerShell or policy prevented the read: everything below is then a guess and Repair stays offered. */
    inspectionAvailable: boolean
    /** An enabled inbound Allow rule for this OXESpace.exe and port, on the Private profile, reaching the LAN. */
    ruleAllowed: boolean
    /** An inbound Block rule for this program and port, which wins over any Allow. Repair never removes it. */
    blockingRuleDetected: boolean
    /** The rule OXESpace added (by its fixed name) exists: Undo can remove it. */
    ownRulePresent: boolean
    privateFirewallEnabled: boolean
    networkCategory: RemoteFirewallNetwork
  }

/** A repair or an undo, done only when a fresh inspection confirms it. `cancelled`: the person said No at the UAC prompt. */
export type RemoteFirewallChange =
  | { ok: true; status: RemoteFirewallStatus }
  | { ok: false; reason: 'unsupported' | 'cancelled' | 'failed' | 'not-verified'; status?: RemoteFirewallStatus }

export interface RemoteChange {
  status?: RemoteGatewayStatus
  devices?: RemoteDevice[]
  /** The prompt waiting for the person, or `null` when it was answered, cancelled or expired. */
  pairing?: RemotePairingPrompt | null
}

export interface RemoteApi {
  status(): Promise<RemoteGatewayStatus>
  devices(): Promise<RemoteDevice[]>
  onChanged(listener: (change: RemoteChange) => void): () => void
  /**
   * A phone's pairing attempt failed (`remote.pairing.failed`). Fires once per failed attempt; it never carries the
   * phone's key, address, name or any identifier.
   */
  onPairingFailed(listener: (message: MainMessage) => void): () => void
  /**
   * On: listens on private interfaces (a certificate is made the first time). Off: closes the port and every connection.
   * A port below `REMOTE_MIN_PORT`, a port in use or no private interface leaves it off with `error` set; a malformed
   * input rejects.
   *
   * The actions below reject with a `MainMessageError` (read it with `messageFromError`) when the person can act on the
   * reason: `remote.gateway.offline`, `remote.pairing.limit`, `remote.device.notFound`, `remote.device.invalidName`,
   * `remote.desktop.invalidName`, `remote.pane.invalid`. Malformed input (wrong types, unknown fields) is a plain Error.
   */
  setEnabled(input: { enabled: boolean; port?: number }): Promise<RemoteGatewayStatus>
  startPairing(): Promise<RemotePairingOffer>
  cancelPairing(): Promise<void>
  answerPairing(input: { promptId: string; accept: boolean }): Promise<void>
  /** Closes the device's connection within a second and invalidates its refresh. Recorded in the audit. */
  revoke(input: { deviceId: string }): Promise<void>
  rename(input: { deviceId: string; name: string }): Promise<RemoteDevice>
  /** The name phones see, at most 32 characters; `null` goes back to the default. */
  setDesktopName(input: { name: string | null }): Promise<RemoteGatewayStatus>
  /** Lets a phone type into one pane, or stops it. Off by default and again when the app restarts. */
  setPhoneWrite(input: { paneId: string; allowed: boolean }): Promise<RemoteGatewayStatus>
  /** CR-34: "Show on phone" for one pane (shown by default). Hiding also stops typing from the phone. Persisted and audited. */
  setPhoneHidden?(input: { paneId: string; hidden: boolean }): Promise<RemoteGatewayStatus>
  /** 1.4.3 P1: whether Windows lets a phone reach the gateway (read only, no elevation). */
  firewallStatus?(): Promise<RemoteFirewallStatus>
  /** 1.4.3 P1: adds the one Private-only rule for this OXESpace.exe and port, through UAC (never silent). */
  firewallRepair?(): Promise<RemoteFirewallChange>
  /** 1.4.3 P1: removes only the rule OXESpace added, by its fixed name, through UAC. */
  firewallUndo?(): Promise<RemoteFirewallChange>
}
