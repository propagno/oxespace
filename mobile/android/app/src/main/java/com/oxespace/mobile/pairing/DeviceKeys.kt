package com.oxespace.mobile.pairing

import android.content.pm.PackageManager
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64

/** The phone's identity towards one desktop: an EC P-256 key whose private half never leaves secure hardware. */
interface DeviceKeys {
    /** SubjectPublicKeyInfo DER of the key, creating it first if there is none. */
    fun publicKeySpki(): ByteArray

    /** ECDSA P-256 with SHA-256 over [data], DER encoded. */
    fun sign(data: ByteArray): ByteArray

    /** Forgets the key: after a revocation or an unpairing, this phone can never sign as that device again. */
    fun delete()
}

/** Base64url without padding, as the contract writes keys and signatures. */
fun ByteArray.base64Url(): String = Base64.getUrlEncoder().withoutPadding().encodeToString(this)

class AndroidKeystoreDeviceKeys(private val context: Context, private val alias: String) : DeviceKeys {
    private val keyStore: KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }

    override fun publicKeySpki(): ByteArray {
        if (!keyStore.containsAlias(alias)) generate()
        return keyStore.getCertificate(alias).publicKey.encoded
    }

    override fun sign(data: ByteArray): ByteArray {
        val key = keyStore.getKey(alias, null) as? PrivateKey ?: error("no device key $alias")
        return Signature.getInstance("SHA256withECDSA").run {
            initSign(key)
            update(data)
            sign()
        }
    }

    override fun delete() {
        if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)
    }

    private fun generate() {
        val strongBox = context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)
        try {
            generate(strongBox)
        } catch (_: StrongBoxUnavailableException) {
            generate(strongBox = false)
        }
    }

    /** No user authentication on the key itself: the background service refreshes tokens with the screen off (M6). */
    private fun generate(strongBox: Boolean) {
        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setIsStrongBoxBacked(strongBox)
            .build()
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, PROVIDER).run {
            initialize(spec)
            generateKeyPair()
        }
    }

    private companion object {
        const val PROVIDER = "AndroidKeyStore"
    }
}
