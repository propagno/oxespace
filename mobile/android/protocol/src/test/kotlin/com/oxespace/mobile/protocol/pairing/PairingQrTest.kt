package com.oxespace.mobile.protocol.pairing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingQrTest {
    private val fp = "a".repeat(64)
    private val code = "AbCdEfGhIjKlMnOpQrSt_-"

    private fun qr(host: String = "192.168.0.12", extra: String = "") =
        "oxespace://pair?v=1&host=$host&port=7443&fp=$fp&code=$code&name=Studio%20PC$extra"

    private fun problem(text: String) = (PairingQrs.read(text) as? PairingQrRead.Refused)?.problem

    @Test
    fun readsAPairingCode() {
        assertEquals(PairingQrRead.Ok(PairingQr("192.168.0.12", 7443, fp, code, "Studio PC")), PairingQrs.read(qr()))
        val v6 = PairingQrs.read(qr(host = "fd12:3456::1c2:3")) as PairingQrRead.Ok
        assertEquals("fd12:3456::1c2:3", v6.qr.host)
        // The contract's host is address characters only: no brackets, no zone.
        assertEquals(PairingQrProblem.MALFORMED, problem(qr(host = "%5Bfe80::1%5D")))
        assertEquals(PairingQrProblem.MALFORMED, problem(qr(host = "fe80::1%25wlan0")))
    }

    @Test
    fun acceptsOnlyLanAddresses() {
        for (host in listOf("10.0.0.5", "172.16.0.1", "172.31.255.254", "192.168.1.1", "169.254.10.20", "fe80::1", "fd12:3456::1", "fc00::abcd", "[fe80::1%eth0]")) {
            assertTrue(host, LanAddress.isPrivate(host))
        }
        for (host in listOf("8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.0.1", "127.0.0.1", "0.0.0.0", "255.255.255.255", "100.64.0.1",
            "2001:db8::1", "::1", "::ffff:192.168.0.1", "desktop.local", "attacker.example", "192.168.0.256", "", "fe80:::1")) {
            assertFalse(host, LanAddress.isPrivate(host))
        }
        assertEquals(PairingQrProblem.PUBLIC_HOST, problem(qr(host = "8.8.8.8")))
        assertEquals(PairingQrProblem.PUBLIC_HOST, problem(qr(host = "studio.local")))
    }

    @Test
    fun refusesWhatIsNotAPairingCode() {
        for (text in listOf("https://oxespace.dev/pair?v=1", "oxespace://open?v=1", "WIFI:S:home;;", "", "not a uri ::")) {
            assertEquals(text, PairingQrProblem.NOT_PAIRING, problem(text))
        }
    }

    @Test
    fun refusesAnotherProtocolVersion() {
        assertEquals(PairingQrProblem.UNSUPPORTED_VERSION, problem(qr().replace("v=1", "v=2")))
    }

    @Test
    fun refusesFieldsOutOfShape() {
        val cases = listOf(
            qr().replace("fp=$fp", "fp=${"A".repeat(64)}"),
            qr().replace("fp=$fp", "fp=${"a".repeat(63)}"),
            qr().replace("code=$code", "code=123456"),
            qr().replace("code=$code", "code=${code}x"),
            qr().replace("port=7443", "port=0"),
            qr().replace("port=7443", "port=70000"),
            qr().replace("&code=$code", ""),
            qr().replace("v=1&", ""),
            // A second code could make two readers disagree.
            qr(extra = "&code=ZZZZZZZZZZZZZZZZZZZZZZ")
        )
        for (text in cases) assertEquals(text, PairingQrProblem.MALFORMED, problem(text))
    }

    @Test
    fun refusesADesktopNameTheContractRefuses() {
        for (name in listOf("x".repeat(65), "%20%20", "Studio%0APC")) assertEquals(name, PairingQrProblem.MALFORMED, problem(qr().replace("name=Studio%20PC", "name=$name")))
        assertEquals(64, (PairingQrs.read(qr().replace("name=Studio%20PC", "name=${"x".repeat(64)}")) as PairingQrRead.Ok).qr.desktopName!!.length)
        assertEquals(null, (PairingQrs.read(qr().replace("&name=Studio%20PC", "")) as PairingQrRead.Ok).qr.desktopName)
        assertEquals(PairingQrProblem.MALFORMED, problem(qr(extra = "&pad=${"x".repeat(1024)}")))
    }

    @Test
    fun bindsTheRefreshSignatureToCertificateDeviceAndConnection() {
        assertEquals("oxespace-refresh:1:$fp:dev-1:nonce-9", refreshSigningInput(fp, "dev-1", "nonce-9"))
    }
}
