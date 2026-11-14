/**
 * What the Android device panel may hand to a device on the person's behalf, beyond taps: a web address to open and
 * the desktop's own pairing link. Both travel through `adb shell`, which gives its arguments to a shell ON THE DEVICE
 * as one line: argument arrays on this side protect nothing there. So each text is checked against a closed set of
 * characters and then travels inside single quotes, where that shell reads every character literally. A text with a
 * quote, a space or anything outside the set is refused, never repaired.
 */

/** The phone app the pairing link is for, and the activity that reads it (a debug build only: a release ignores it). */
export const OXESPACE_PHONE_PACKAGE = 'com.oxespace.mobile'
export const OXESPACE_PHONE_ACTIVITY = `${OXESPACE_PHONE_PACKAGE}/.MainActivity`
export const PAIR_LINK_EXTRA = 'pair_link'

export const DEVICE_LINK_MAX_LENGTH = 2048

/** RFC 3986's characters without the ones a shell gives a meaning to: quotes, backtick, `$`, `;`, `|`, `<`, `>`, parentheses, backslash, space. */
const LINK_CHARACTERS = /^[A-Za-z0-9\-._~:/?#[\]@!*+,=%&]+$/

export type DeviceLinkRefusal = 'empty' | 'tooLong' | 'scheme' | 'characters' | 'malformed'

/** Why a web address may not be opened on a device, or null when it may. Only http and https, and no component. */
export function deviceLinkRefusal(text: unknown): DeviceLinkRefusal | null {
  if (typeof text !== 'string' || !text) return 'empty'
  if (text.length > DEVICE_LINK_MAX_LENGTH) return 'tooLong'
  if (!/^https?:\/\//i.test(text)) return 'scheme'
  if (!LINK_CHARACTERS.test(text)) return 'characters'
  let url: URL
  try { url = new URL(text) } catch { return 'malformed' }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return 'malformed'
  return null
}

/** The desktop's pairing link as its QR carries it (`oxespace://pair?v=…&host=…`), with nothing a shell would read. */
export function isPairLink(text: unknown): text is string {
  return typeof text === 'string' && text.length <= DEVICE_LINK_MAX_LENGTH && /^oxespace:\/\/pair\?[A-Za-z0-9\-._~:@!*+,=%&]+$/.test(text)
}

/** The text as the device's shell takes it: one literal word. Callers check the text first; a quote here is a bug. */
export function quotedForDeviceShell(text: string): string {
  if (/['\s\\]/.test(text) || /[\x00-\x1f\x7f]/.test(text)) throw new Error('Refused text for the device shell')
  return `'${text}'`
}

/** What `dumpsys package` says about the phone app on a device. */
export type PhoneAppBuild = 'absent' | 'release' | 'debug'

/** Reads the build from `adb shell dumpsys package com.oxespace.mobile`: a package with DEBUGGABLE among its flags is a debug build. */
export function phoneAppBuild(dumpsys: string): PhoneAppBuild {
  if (!new RegExp(`Package \\[${OXESPACE_PHONE_PACKAGE.replace(/\./g, '\\.')}\\]`).test(dumpsys)) return 'absent'
  const flags = /^\s*(?:pkgFlags|flags)=\[([^\]]*)\]/m.exec(dumpsys)?.[1] ?? ''
  return /\bDEBUGGABLE\b/.test(flags) ? 'debug' : 'release'
}

/** `adb install` ends with "Success" or with "Failure [INSTALL_FAILED_…]": the reason, or null when it worked. */
export function installFailure(output: string): string | null {
  if (/^\s*Success\s*$/m.test(output)) return null
  const reason = /Failure \[([A-Za-z0-9_.: -]{1,120})/.exec(output)?.[1] ?? /(?:adb: |error: )([^\r\n]{1,160})/i.exec(output)?.[1]
  return (reason ?? 'unknown').trim()
}

/** `am start` prints "Error: …" when nothing on the device takes the intent: that line, or null when it started. */
export function startFailure(output: string): string | null {
  const line = /^\s*(Error[^\r\n]{0,160}|.*unable to resolve Intent[^\r\n]{0,80})/mi.exec(output)?.[1]
  return line ? line.trim() : null
}
