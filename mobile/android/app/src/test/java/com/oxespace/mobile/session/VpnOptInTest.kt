package com.oxespace.mobile.session

import android.net.NetworkCapabilities
import com.oxespace.mobile.protocol.pairing.LanAddress
import com.oxespace.mobile.settings.PhonePreferences
import com.oxespace.mobile.settings.PreferenceStore
import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/*
 * OXE-383 (part B2a): the phone and a VPN (Tailscale, WireGuard). "Connect over a VPN" is off by default. Off, nothing
 * changes: only Wi-Fi or Ethernet reach the desktop, and only RFC 1918, link-local and ULA addresses are trusted. On, a
 * network that carries TRANSPORT_VPN counts as reachable, and a 100.64/10 address is trusted only while the active
 * network has TRANSPORT_VPN: the same range over plain 4G/5G is carrier-grade NAT and stays refused. The switch and its
 * wiring into the session come in part B2b; here nothing can turn it on yet.
 */
class VpnOptInTest {
    private val wifi = NetworkCapabilities.TRANSPORT_WIFI
    private val ethernet = NetworkCapabilities.TRANSPORT_ETHERNET
    private val cellular = NetworkCapabilities.TRANSPORT_CELLULAR
    private val vpn = NetworkCapabilities.TRANSPORT_VPN

    @Test
    fun withTheSettingOnA100_64AddressOverPlainCellularWithoutTransportVpnIsRefused() {
        assertFalse("cellular without VPN, setting on", LanAddress.isReachable("100.101.102.103", vpnAllowed = true, onVpn = false))
        assertFalse("CGNAT edge, setting on, no VPN", LanAddress.isReachable("100.64.0.1", vpnAllowed = true, onVpn = false))
        assertFalse("setting off, even on a VPN", LanAddress.isReachable("100.101.102.103", vpnAllowed = false, onVpn = true))
        assertTrue("setting on and on a VPN", LanAddress.isReachable("100.101.102.103", vpnAllowed = true, onVpn = true))
        assertFalse("outside 100.64/10, even on a VPN", LanAddress.isReachable("100.128.0.1", vpnAllowed = true, onVpn = true))
        assertFalse("a public address is never reachable", LanAddress.isReachable("8.8.8.8", vpnAllowed = true, onVpn = true))
        // Private addresses are as before, whatever the switch says.
        for (allowed in listOf(false, true)) for (onVpn in listOf(false, true)) {
            assertTrue(LanAddress.isReachable("192.168.0.10", allowed, onVpn))
            assertTrue(LanAddress.isReachable("fd7a:115c:a1e0::1", allowed, onVpn))
        }
        // CGNAT alone is not private: the QR check (PairingQr) and every other isPrivate caller are unchanged.
        assertFalse(LanAddress.isPrivate("100.101.102.103"))
        assertTrue(LanAddress.isCgnat("100.64.0.0"))
        assertTrue(LanAddress.isCgnat("100.127.255.255"))
        assertFalse(LanAddress.isCgnat("100.63.255.255"))
        assertFalse(LanAddress.isCgnat("[fd7a:115c:a1e0::1]"))
    }

    @Test
    fun aVpnNetworkCountsOnlyWithTheSettingOnAndPlainCellularNever() {
        assertTrue(NetworkMonitor.reachableTransport(setOf(wifi), vpnAllowed = false))
        assertTrue(NetworkMonitor.reachableTransport(setOf(ethernet), vpnAllowed = false))
        assertFalse(NetworkMonitor.reachableTransport(setOf(cellular), vpnAllowed = false))
        assertFalse(NetworkMonitor.reachableTransport(setOf(cellular), vpnAllowed = true))
        assertFalse("a VPN with the setting off", NetworkMonitor.reachableTransport(setOf(cellular, vpn), vpnAllowed = false))
        assertTrue("a VPN over 4G/5G with the setting on", NetworkMonitor.reachableTransport(setOf(cellular, vpn), vpnAllowed = true))
        assertTrue("a VPN network that reports only VPN", NetworkMonitor.reachableTransport(setOf(vpn), vpnAllowed = true))
        assertFalse(NetworkMonitor.reachableTransport(emptySet(), vpnAllowed = true))
    }

    @Test
    fun theSettingIsOffByDefault() {
        val values = mutableMapOf<String, String>()
        val prefs = PhonePreferences(object : PreferenceStore {
            override fun getString(key: String): String? = values[key]
            override fun putString(key: String, value: String) { values[key] = value }
        })
        assertFalse("off by default", prefs.connectOverVpn)
        prefs.connectOverVpn = true
        assertTrue(prefs.connectOverVpn)
        values.keys.single().let { key -> values[key] = "maybe" }
        assertFalse("a value the app doesn't know is off", prefs.connectOverVpn)

        val monitor = File("src/main/java/com/oxespace/mobile/session/NetworkMonitor.kt").readText()
        assertTrue("the monitor's switch defaults to off", Regex("""vpnAllowed: \(\) -> Boolean = \{ false \}""").containsMatchIn(monitor))
    }
}
