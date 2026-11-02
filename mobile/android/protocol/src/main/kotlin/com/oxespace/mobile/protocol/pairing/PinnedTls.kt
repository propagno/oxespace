package com.oxespace.mobile.protocol.pairing

import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLPeerUnverifiedException
import javax.net.ssl.X509TrustManager
import okhttp3.ConnectionSpec
import okhttp3.OkHttpClient

/** Lowercase hex SHA-256 of a certificate's DER encoding, as the QR carries it. */
fun certificateFingerprint(certificate: X509Certificate): String =
    MessageDigest.getInstance("SHA-256").digest(certificate.encoded).joinToString("") { "%02x".format(it) }

/**
 * Trusts exactly one certificate: the gateway's self-signed one, by the fingerprint the QR carried. No certificate
 * authority, system store or user-installed CA can stand in for it, and a different certificate ends the handshake.
 */
class PinnedTrustManager(private val fingerprint: String) : X509TrustManager {
    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        val leaf = chain?.firstOrNull() ?: throw CertificateException("no certificate")
        if (certificateFingerprint(leaf) != fingerprint) throw CertificateException("certificate is not the paired desktop's")
    }

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) =
        throw CertificateException("the phone never accepts client connections")

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

object PinnedTls {
    /**
     * An HTTPS and WSS client for one gateway. The pin replaces host name checks: the gateway is reached by a LAN
     * address its self-signed certificate can't name, and the hostname verifier re-checks the pin on the session.
     * `callTimeoutMs` covers the wait while the person decides on the desktop.
     */
    fun client(fingerprint: String, callTimeoutMs: Long = 30_000): OkHttpClient {
        val trust = PinnedTrustManager(fingerprint)
        val context = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trust), null) }
        return OkHttpClient.Builder()
            .sslSocketFactory(context.socketFactory, trust)
            .hostnameVerifier { _, session ->
                val leaf = try {
                    session.peerCertificates.firstOrNull() as? X509Certificate
                } catch (_: SSLPeerUnverifiedException) {
                    null
                }
                leaf != null && certificateFingerprint(leaf) == fingerprint
            }
            .connectionSpecs(listOf(ConnectionSpec.RESTRICTED_TLS))
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(10, TimeUnit.SECONDS)
            .callTimeout(callTimeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(callTimeoutMs, TimeUnit.MILLISECONDS)
            .build()
    }
}
