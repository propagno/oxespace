package com.oxespace.mobile.protocol.pairing

import com.oxespace.mobile.protocol.REMOTE_PAIRING_SCHEME
import com.oxespace.mobile.protocol.REMOTE_PROTOCOL_VERSION
import com.oxespace.mobile.protocol.RemoteLimits
import java.net.URI
import java.net.URISyntaxException
import java.net.URLDecoder

/** A pairing QR the app can act on. `fingerprint` is the certificate pin for every later connection. */
data class PairingQr(
    val host: String,
    val port: Int,
    val fingerprint: String,
    val code: String,
    val desktopName: String?,
)

/** Why a scanned code can't pair; each one has its own message in the app. */
enum class PairingQrProblem {
    /** Not an OXESpace pairing code at all. */
    NOT_PAIRING,
    /** From a desktop that speaks another protocol version. */
    UNSUPPORTED_VERSION,
    /** The address isn't on the local network. */
    PUBLIC_HOST,
    /** A field is missing or out of shape. */
    MALFORMED,
}

sealed interface PairingQrRead {
    data class Ok(val qr: PairingQr) : PairingQrRead
    data class Refused(val problem: PairingQrProblem) : PairingQrRead
}

object PairingQrs {
    private val fingerprint = Regex("^[0-9a-f]{64}$")
    private val code = Regex("^[A-Za-z0-9_-]{22}$")
    private val host = Regex("^[A-Za-z0-9.:-]{1,253}$")
    private const val MAX_URI = 1024

    /** Same acceptance as `readPairingUri` in shared/remote/protocol.ts, plus the app's rule of LAN addresses only. */
    fun read(text: String): PairingQrRead {
        if (text.length > MAX_URI) return PairingQrRead.Refused(PairingQrProblem.MALFORMED)
        val uri = try {
            URI(text.trim())
        } catch (_: URISyntaxException) {
            return PairingQrRead.Refused(PairingQrProblem.NOT_PAIRING)
        }
        if (uri.scheme != REMOTE_PAIRING_SCHEME || uri.rawSchemeSpecificPart?.startsWith("//pair") != true) {
            return PairingQrRead.Refused(PairingQrProblem.NOT_PAIRING)
        }
        val query = uri.rawQuery ?: return PairingQrRead.Refused(PairingQrProblem.MALFORMED)
        val fields = mutableMapOf<String, String>()
        for (pair in query.split('&')) {
            val name = pair.substringBefore('=')
            val value = try {
                URLDecoder.decode(pair.substringAfter('=', ""), Charsets.UTF_8)
            } catch (_: IllegalArgumentException) {
                return PairingQrRead.Refused(PairingQrProblem.MALFORMED)
            }
            // A repeated field could make two readers see two different codes; refuse instead of picking one.
            if (fields.put(name, value) != null) return PairingQrRead.Refused(PairingQrProblem.MALFORMED)
        }
        val version = fields["v"]?.toIntOrNull() ?: return PairingQrRead.Refused(PairingQrProblem.MALFORMED)
        if (version != REMOTE_PROTOCOL_VERSION) return PairingQrRead.Refused(PairingQrProblem.UNSUPPORTED_VERSION)
        val address = fields["host"]?.takeIf { host.matches(it) } ?: return PairingQrRead.Refused(PairingQrProblem.MALFORMED)
        if (!LanAddress.isPrivate(address)) return PairingQrRead.Refused(PairingQrProblem.PUBLIC_HOST)
        val port = fields["port"]?.toIntOrNull()?.takeIf { it in 1..65535 } ?: return PairingQrRead.Refused(PairingQrProblem.MALFORMED)
        val pin = fields["fp"]?.takeIf { fingerprint.matches(it) } ?: return PairingQrRead.Refused(PairingQrProblem.MALFORMED)
        val oneTimeCode = fields["code"]?.takeIf { code.matches(it) } ?: return PairingQrRead.Refused(PairingQrProblem.MALFORMED)
        val name = fields["name"]
        if (name != null && (name.isBlank() || name.length > RemoteLimits.MAX_DEVICE_NAME_LENGTH || name.any { it.isISOControl() })) {
            return PairingQrRead.Refused(PairingQrProblem.MALFORMED)
        }
        return PairingQrRead.Ok(PairingQr(address, port, pin, oneTimeCode, name))
    }
}
