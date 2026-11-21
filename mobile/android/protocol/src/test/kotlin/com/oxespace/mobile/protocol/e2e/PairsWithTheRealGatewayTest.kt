package com.oxespace.mobile.protocol.e2e

import com.oxespace.mobile.protocol.pairing.PairOutcome
import com.oxespace.mobile.protocol.pairing.PairingClient
import com.oxespace.mobile.protocol.pairing.PairingQrRead
import com.oxespace.mobile.protocol.pairing.PairingQrs
import com.oxespace.mobile.protocol.pairing.PinnedTls
import com.oxespace.mobile.protocol.session.DesktopTarget
import com.oxespace.mobile.protocol.session.RemoteConnection
import com.oxespace.mobile.protocol.session.SessionState
import com.oxespace.mobile.protocol.session.TokenHolder
import java.io.File
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import java.util.concurrent.Executors
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Frozen end-to-end support for 1.5.2 Celular A16 (Jira OXE-179 CA-4). Written by the planner; the executor must not
 * edit it.
 *
 * The phone's real protocol code (PairingQrs, PairingClient over pinned TLS, RemoteConnection over WSS with the
 * SessionProtocol) against the desktop's real gateway: tests/oxe152/mobile/oxe179-pairing-details.native.test.ts starts
 * the gateway, offers a code, accepts the prompt, runs this test through Gradle with OXE_E2E_PAIR_URI (the QR's URI)
 * and OXE_E2E_OUT (a file), and checks what it wrote: the QR as the phone read it, the pairing outcome, and the session
 * state once signed in. Without those variables (any other Gradle run) it is skipped. It uses only API that exists on
 * main and reports through toString, so it compiles before the task.
 */
class PairsWithTheRealGatewayTest {
    @Test
    fun pairsAndSignsInWithTheRealGateway() {
        val uri = System.getenv("OXE_E2E_PAIR_URI")
        assumeTrue("run by oxe179-pairing-details.native.test.ts", !uri.isNullOrBlank())
        val out = File(System.getenv("OXE_E2E_OUT") ?: error("OXE_E2E_OUT is not set"))
        val lines = mutableListOf<String>()
        val scheduler = Executors.newSingleThreadScheduledExecutor()
        try {
            // The gateway listens on loopback in the test; the phone reads LAN addresses only, so the QR is read with a
            // private address and dialled on loopback.
            val read = PairingQrs.read(uri!!.replace(Regex("host=[^&]*"), "host=192.168.0.12"))
            lines += "qr=$read"
            val qr = (read as PairingQrRead.Ok).qr.copy(host = "127.0.0.1")
            val keyPair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
            val publicKey = Base64.getUrlEncoder().withoutPadding().encodeToString(keyPair.public.encoded)
            val outcome = PairingClient(clientFor = { PinnedTls.client(it, 60_000) }, hostAllowed = { it == "127.0.0.1" }).pair(qr, "Pixel e2e", publicKey)
            lines += "pair=$outcome"
            val paired = outcome as PairOutcome.Paired
            val connection = RemoteConnection(
                target = DesktopTarget(paired.response.deviceId, qr.fingerprint, qr.port, listOf("127.0.0.1")),
                sign = { data -> Signature.getInstance("SHA256withECDSA").run { initSign(keyPair.private); update(data); sign() } },
                tokens = TokenHolder(),
                scheduler = scheduler,
                hostAllowed = { it == "127.0.0.1" },
            )
            connection.connect()
            val deadline = System.currentTimeMillis() + 30_000
            while (System.currentTimeMillis() < deadline && connection.state.value !is SessionState.Ready && connection.state.value !is SessionState.Ended) Thread.sleep(50)
            lines += "session=${connection.state.value}"
            connection.close()
        } catch (error: Throwable) {
            lines += "error=$error"
            throw error
        } finally {
            scheduler.shutdownNow()
            out.writeText(lines.joinToString("\n"))
        }
    }
}
