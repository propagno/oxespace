package com.oxespace.mobile.pairing

/**
 * The emulator can't point its camera at the desktop's QR, so homologation on the AVD hands the app the QR's text
 * instead: a debug build started with
 * `adb shell am start -n com.oxespace.mobile/.MainActivity --es pair_link "oxespace://pair?…"` while unpaired treats it
 * as one camera frame. It goes through [PairingFlow.onScanned] like any scan (LAN-only host, pinned fingerprint, the
 * two-minute code, the reserved-name check); nothing is skipped. A release build ignores the extra.
 */
object PairLinkForHomologation {
    const val EXTRA = "pair_link"

    /** The link to scan, or null: only in a debug build ([debug] is `BuildConfig.DEBUG`), and only a non-blank one. */
    fun read(debug: Boolean, link: String?): String? = link?.takeIf { debug && it.isNotBlank() }
}
