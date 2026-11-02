package com.oxespace.mobile.protocol.pairing

import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.spec.ECGenParameterSpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The vectors of the C5 contract, so the phone and the desktop show the same code. */
class PairingVerificationTest {
    @Test
    fun matchesTheContractVectors() {
        assertEquals("ZZZZZZ", PairingVerification.ofDigest(ByteArray(32) { 0xff.toByte() }))
        assertEquals("000000", PairingVerification.ofDigest(ByteArray(32)))
        assertEquals("28T5CY", PairingVerification.ofDigest(byteArrayOf(0x12, 0x34, 0x56, 0x78) + ByteArray(28)))
    }

    @Test
    fun hashesTheSpkiOfARealDeviceKey() {
        val key = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair().public
        // An uncompressed P-256 SubjectPublicKeyInfo is 91 bytes, as isDevicePublicKey expects.
        assertEquals(91, key.encoded.size)
        val code = PairingVerification.of(key.encoded)
        assertEquals(PairingVerification.ofDigest(MessageDigest.getInstance("SHA-256").digest(key.encoded)), code)
        assertTrue(code, Regex("^[0-9A-HJKMNP-TV-Z]{6}$").matches(code))
    }

    @Test(expected = IllegalArgumentException::class)
    fun refusesSomethingThatIsNotADigest() {
        PairingVerification.ofDigest(ByteArray(31))
    }
}
