package com.oxespace.mobile.protocol.pairing

import com.oxespace.mobile.protocol.REMOTE_PAIRING_PATH
import com.oxespace.mobile.protocol.RemoteLimits
import com.oxespace.mobile.protocol.RemotePairRequest
import com.oxespace.mobile.protocol.RemotePairResponse
import com.oxespace.mobile.protocol.RemotePairingErrorCode
import java.io.IOException
import java.net.InetAddress
import javax.net.ssl.SSLException
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody

sealed interface PairOutcome {
    data class Paired(val response: RemotePairResponse) : PairOutcome
    /** The desktop said no, with its reason (expired or used code, refused by the person, locked, full). */
    data class Refused(val error: RemotePairingErrorCode) : PairOutcome
    /** The certificate isn't the one in the QR: someone else answered at that address. Nothing was sent. */
    data object PinMismatch : PairOutcome
    /** No answer: the desktop is off, on another network, or the gateway is turned off. */
    data object Unreachable : PairOutcome
    /** An answer that doesn't follow the contract. */
    data object Protocol : PairOutcome
}

/**
 * Pairs this phone with the desktop of a scanned QR: one POST to `/pair` over TLS pinned to the QR's fingerprint.
 * The call waits while the desktop asks the person, up to the life of the code.
 */
class PairingClient(
    private val clientFor: (fingerprint: String) -> OkHttpClient = { PinnedTls.client(it, RemoteLimits.PAIRING_CODE_TTL_MS + 10_000) },
    /** Only tests widen this, to reach their fake gateway on loopback. */
    private val hostAllowed: (String) -> Boolean = LanAddress::isPrivate,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val mediaType = "application/json".toMediaType()
    private val maxBodyBytes = RemoteLimits.MAX_FRAME_BYTES.toLong()

    fun pair(qr: PairingQr, deviceName: String, publicKey: String): PairOutcome {
        // Rechecked here so no caller can reach a public address by building a PairingQr by hand.
        if (!hostAllowed(qr.host)) return PairOutcome.Protocol
        val url = HttpUrl.Builder().scheme("https").host(literalHost(qr.host) ?: return PairOutcome.Protocol).port(qr.port).addPathSegment(REMOTE_PAIRING_PATH.removePrefix("/")).build()
        val body = json.encodeToString(RemotePairRequest.serializer(), RemotePairRequest(qr.code, pairingDeviceName(deviceName), publicKey))
        val request = okhttp3.Request.Builder().url(url).post(body.toRequestBody(mediaType)).build()
        return try {
            clientFor(qr.fingerprint).newCall(request).execute().use { response ->
                val text = response.body.source().let { source ->
                    if (!source.request(maxBodyBytes + 1)) source.buffer.readUtf8() else return PairOutcome.Protocol
                }
                when {
                    response.isSuccessful -> PairOutcome.Paired(json.decodeFromString(RemotePairResponse.serializer(), text))
                    response.code in 400..499 -> {
                        val code = json.decodeFromString(PairingErrorBody.serializer(), text).code
                        RemotePairingErrorCode.fromWire(code)?.let { PairOutcome.Refused(it) } ?: PairOutcome.Protocol
                    }
                    else -> PairOutcome.Protocol
                }
            }
        } catch (_: SSLException) {
            PairOutcome.PinMismatch
        } catch (_: SerializationException) {
            PairOutcome.Protocol
        } catch (_: IllegalArgumentException) {
            PairOutcome.Protocol
        } catch (_: IOException) {
            PairOutcome.Unreachable
        }
    }

    /** The host as OkHttp expects it, from a literal only: never a name lookup. */
    private fun literalHost(host: String): String? =
        try {
            InetAddress.getByName(if (host.contains(':')) "[${host.substringBefore('%')}]" else host).hostAddress
        } catch (_: IOException) {
            null
        }
}

/** Body of a 4xx from `/pair`: `{ code }` from REMOTE_PAIRING_ERROR_CODES. */
@Serializable
private class PairingErrorBody(val code: String)
