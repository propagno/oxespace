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
  /** Why it is not listening (port in use, firewall, certificate…), as a code the window translates. */
  error?: MainMessage
  /**
   * True once the gateway has really listened on this profile, and never false again: the window explains the system
   * firewall's question before the first time only.
   */
  listenedBefore: boolean
}

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
 * (`refused`), the device limit (`limit`), or the phone hung up while the question was on screen (`peer-closed`).
 */
export const REMOTE_PAIRING_FAILURE_REASONS = ['invalid', 'expired', 'refused', 'limit', 'peer-closed'] as const
export type RemotePairingFailureReason = typeof REMOTE_PAIRING_FAILURE_REASONS[number]

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
}
