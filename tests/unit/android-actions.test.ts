import { describe, expect, test } from 'vitest'
import { deviceLinkRefusal, installFailure, isPairLink, phoneAppBuild, quotedForDeviceShell, startFailure } from '../../shared/android-actions'

describe('what the Android panel may hand to a device', () => {
  test('a web address: http or https, written plainly', () => {
    for (const ok of ['https://example.com', 'http://192.168.0.10:5173/cart?id=7&tab=2#top', 'https://a.b/p%20q/~x_y-z.html?x=[1]&y=a,b', 'HTTPS://Example.com/']) expect(deviceLinkRefusal(ok), ok).toBeNull()
  })

  test('anything the device\'s shell would read as more than one word is refused, never repaired', () => {
    const refused: Array<[string, string]> = [
      ["https://a.b/';id;'", 'characters'], ['https://a.b/$(reboot)', 'characters'], ['https://a.b/`id`', 'characters'], ['https://a.b/x y', 'characters'],
      ['https://a.b/x\nreboot', 'characters'], ['https://a.b/x;reboot', 'characters'], ['https://a.b/x|sh', 'characters'], ['https://a.b/x>y', 'characters'],
      ['https://a.b/x\\y', 'characters'], ['https://a.b/"x"', 'characters'], ['https://a.b/(x)', 'characters']
    ]
    for (const [text, why] of refused) expect(deviceLinkRefusal(text), text).toBe(why)
  })

  test('other schemes, a component, an empty or an endless text are refused', () => {
    for (const text of ['intent://scan/#Intent;scheme=zxing;end', 'file:///sdcard/x.html', 'content://media/1', 'market://details?id=x', 'javascript:alert(1)', 'oxespace://pair?v=1', 'example.com', '-n com.x/.Y']) expect(deviceLinkRefusal(text), text).toBe('scheme')
    expect(deviceLinkRefusal('')).toBe('empty')
    expect(deviceLinkRefusal(undefined)).toBe('empty')
    expect(deviceLinkRefusal(`https://a.b/${'x'.repeat(2050)}`)).toBe('tooLong')
    expect(deviceLinkRefusal('https://')).toBe('malformed')
  })

  test('the pairing link is the desktop\'s own, with nothing a shell would read', () => {
    expect(isPairLink('oxespace://pair?v=3&host=192.168.0.10&port=47821&fp=AB:CD:EF&code=7K2M9Q&name=My%20desk')).toBe(true)
    for (const text of ["oxespace://pair?v=3&code=x'y", 'oxespace://pair?v=3 code=x', 'oxespace://pair?v=3;reboot', 'oxespace://pair?v=$(id)', 'oxespace://other?v=3', 'https://pair?v=3', 'oxespace://pair?', 42, null]) expect(isPairLink(text), String(text)).toBe(false)
  })

  test('a checked text travels as one literal word; a quote, a space or a control character never does', () => {
    expect(quotedForDeviceShell('https://a.b/x?y=1&z=2')).toBe("'https://a.b/x?y=1&z=2'")
    for (const text of ["a'b", 'a b', 'a\tb', 'a\\b', 'a\u0000b']) expect(() => quotedForDeviceShell(text), JSON.stringify(text)).toThrow()
  })

  test('the phone app on the device: absent, a release build, or a debug build', () => {
    expect(phoneAppBuild('Unable to find package: com.oxespace.mobile')).toBe('absent')
    expect(phoneAppBuild('')).toBe('absent')
    const header = 'Packages:\n  Package [com.oxespace.mobile] (1a2b3c):\n    userId=10234\n    versionName=1.5.0\n'
    expect(phoneAppBuild(`${header}    flags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ]\n`)).toBe('release')
    expect(phoneAppBuild(`${header}    pkgFlags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ]\n`)).toBe('debug')
    // Another package's flags, printed first, say nothing about this one's absence.
    expect(phoneAppBuild('  Package [com.other] (9f):\n    flags=[ DEBUGGABLE ]\n')).toBe('absent')
  })

  test('adb install and am start: the reason they give when they fail', () => {
    expect(installFailure('Performing Streamed Install\nSuccess\n')).toBeNull()
    expect(installFailure('Performing Streamed Install\nadb: failed to install app.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package signatures do not match]')).toBe('INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package signatures do not match')
    expect(installFailure('adb: failed to stat x.apk: No such file or directory')).toBe('failed to stat x.apk: No such file or directory')
    expect(installFailure('')).toBe('unknown')
    expect(startFailure('Starting: Intent { act=android.intent.action.VIEW dat=https://example.com/... }\n')).toBeNull()
    expect(startFailure('Starting: Intent { ... }\nError: Activity not started, unable to resolve Intent { act=android.intent.action.VIEW }')).toBe('Error: Activity not started, unable to resolve Intent { act=android.intent.action.VIEW }')
  })
})
