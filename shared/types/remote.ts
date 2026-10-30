import type { MainMessage } from '../messages'

/**
 * Settings › Devices: the desktop side of the remote gateway (B9). The phone side speaks the C5 protocol in
 * `shared/remote/protocol.ts`; these are the window's channels. Every action here is the person's own: none of them is an
 * MCP tool, and the main process accepts them only from the app's window.
 */

/** Ports below this are refused when the person picks one (`remote.port.privileged`). */
export const REMOTE_MIN_PORT = 1024

export interface RemoteGatewayStatus {
  enabled: boolean
  /** Where it listens: private interfaces only (RFC 1918, link-local, ULA). `null` while off or failing. */
  listening: { addresses: string[]; port: number } | null
  /** SHA-256 of the certificate DER, 64 lowercase hex characters, once a certificate exists. */
  fingerprint: string | null
  devices: number
  maxDevices: number
  /** Why it is not listening (port in use, firewall, certificate…), as a code the window translates. */
  error?: MainMessage
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
   * On: listens on private interfaces (a certificate is made the first time). Off: closes the port and every connection.
   * A port below `REMOTE_MIN_PORT`, a port in use or no private interface leaves it off with `error` set; a malformed
   * input rejects.
   */
  setEnabled(input: { enabled: boolean; port?: number }): Promise<RemoteGatewayStatus>
  startPairing(): Promise<RemotePairingOffer>
  cancelPairing(): Promise<void>
  answerPairing(input: { promptId: string; accept: boolean }): Promise<void>
  /** Closes the device's connection within a second and invalidates its refresh. Recorded in the audit. */
  revoke(input: { deviceId: string }): Promise<void>
  rename(input: { deviceId: string; name: string }): Promise<RemoteDevice>
}
