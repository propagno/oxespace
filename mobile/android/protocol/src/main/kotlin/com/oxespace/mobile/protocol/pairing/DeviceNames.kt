package com.oxespace.mobile.protocol.pairing

import com.oxespace.mobile.protocol.REMOTE_RESERVED_NAMES
import com.oxespace.mobile.protocol.REMOTE_RESERVED_NAME_FRAGMENTS
import com.oxespace.mobile.protocol.RemoteLimits

/**
 * The name `/pair` gets for this phone: control and format characters out (zero-width, bidi overrides, tags, which
 * could make the desktop show something other than what is stored), trimmed and cut to the gateway's limit.
 */
fun pairingDeviceName(name: String): String {
    val visible = buildString {
        name.codePoints().forEach { if (!Character.isISOControl(it) && Character.getType(it) != Character.FORMAT.toInt()) appendCodePoint(it) }
    }
    return visible.trim().take(RemoteLimits.MAX_DEVICE_NAME_LENGTH).trim().ifEmpty { "Android" }
}

/**
 * Whether [name] is one only OXESpace may speak as (the desktop's `reservedNameIn`, B10): a product name anywhere in it,
 * or a generic word as the whole name. A plain, case-insensitive check before the code is spent; the desktop also folds
 * accents and look-alikes, so its `reserved-name` refusal can still come.
 */
fun isReservedDeviceName(name: String): Boolean {
    val sent = pairingDeviceName(name)
    return REMOTE_RESERVED_NAME_FRAGMENTS.any { sent.contains(it, ignoreCase = true) } ||
        REMOTE_RESERVED_NAMES.any { sent.equals(it, ignoreCase = true) }
}
