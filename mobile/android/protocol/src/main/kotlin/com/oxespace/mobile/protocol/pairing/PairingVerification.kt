package com.oxespace.mobile.protocol.pairing

import java.security.MessageDigest

/**
 * The 6 characters both screens show while pairing, as `pairingVerification` in shared/remote/protocol.ts: the first
 * 30 bits of SHA-256 over the device public key's SPKI DER, in Crockford base32, most significant character first.
 */
object PairingVerification {
    private const val ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

    fun of(publicKeySpki: ByteArray): String = ofDigest(MessageDigest.getInstance("SHA-256").digest(publicKeySpki))

    fun ofDigest(spkiSha256: ByteArray): String {
        require(spkiSha256.size == 32) { "Expected a SHA-256 digest" }
        var bits = (0 until 4).fold(0L) { value, index -> value * 256 + (spkiSha256[index].toInt() and 0xff) } / 4
        val text = CharArray(6)
        for (index in 5 downTo 0) {
            text[index] = ALPHABET[(bits % 32).toInt()]
            bits /= 32
        }
        return String(text)
    }
}
