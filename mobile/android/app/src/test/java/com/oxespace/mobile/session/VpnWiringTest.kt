package com.oxespace.mobile.session

import androidx.compose.ui.semantics.Role
import com.oxespace.mobile.pairing.DeviceKeys
import com.oxespace.mobile.pairing.PairedDesktop
import com.oxespace.mobile.pairing.PairedDesktopStore
import com.oxespace.mobile.protocol.pairing.LanAddress
import com.oxespace.mobile.protocol.pairing.PairingQrProblem
import com.oxespace.mobile.protocol.pairing.PairingQrRead
import com.oxespace.mobile.protocol.pairing.PairingQrs
import com.oxespace.mobile.protocol.session.DesktopTarget
import com.oxespace.mobile.protocol.session.SessionLink
import com.oxespace.mobile.protocol.session.SessionState
import com.oxespace.mobile.settings.PhonePreferences
import com.oxespace.mobile.settings.PreferenceStore
import com.oxespace.mobile.ui.f4.catalog
import com.oxespace.mobile.ui.f4.f4Paparazzi
import com.oxespace.mobile.ui.f4.render
import com.oxespace.mobile.ui.settings.CantConnectSettings
import java.io.File
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * OXE-383 (part B2b): wires the phone's "Connect over a VPN" switch into Settings, SessionCore,
 * DesktopSessionController, PairingQrs, and PairingViewModel, keeping strict LAN-only defaults.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VpnWiringTest {
    @get:Rule
    val paparazzi = f4Paparazzi()

    private val fp = "a".repeat(64)
    private val code = "AbCdEfGhIjKlMnOpQrSt_-"

    private fun qr(host: String) = "oxespace://pair?v=1&host=$host&port=7443&fp=$fp&code=$code&name=Studio"

    @Test
    fun pairingQrEnforcesCgnatBoundariesAndVpnOptIn() {
        // Default (LAN-only): CGNAT addresses are refused as PUBLIC_HOST.
        assertEquals(PairingQrRead.Refused(PairingQrProblem.PUBLIC_HOST), PairingQrs.read(qr("100.64.0.1")))
        assertEquals(PairingQrRead.Refused(PairingQrProblem.PUBLIC_HOST), PairingQrs.read(qr("100.127.255.254")))

        val vpnOff: (String) -> Boolean = { LanAddress.isReachable(it, vpnAllowed = false, onVpn = true) }
        val noVpn: (String) -> Boolean = { LanAddress.isReachable(it, vpnAllowed = true, onVpn = false) }
        val vpnActive: (String) -> Boolean = { LanAddress.isReachable(it, vpnAllowed = true, onVpn = true) }

        // Opt-in OFF or not on TRANSPORT_VPN: CGNAT refused.
        assertEquals(PairingQrRead.Refused(PairingQrProblem.PUBLIC_HOST), PairingQrs.read(qr("100.64.0.1"), vpnOff))
        assertEquals(PairingQrRead.Refused(PairingQrProblem.PUBLIC_HOST), PairingQrs.read(qr("100.64.0.1"), noVpn))

        // Opt-in ON and on TRANSPORT_VPN: 100.64.0.0/10 boundaries accepted, adjacent/public refused.
        assertTrue(PairingQrs.read(qr("100.64.0.1"), vpnActive) is PairingQrRead.Ok)
        assertTrue(PairingQrs.read(qr("100.127.255.254"), vpnActive) is PairingQrRead.Ok)
        assertEquals(PairingQrRead.Refused(PairingQrProblem.PUBLIC_HOST), PairingQrs.read(qr("100.63.255.255"), vpnActive))
        assertEquals(PairingQrRead.Refused(PairingQrProblem.PUBLIC_HOST), PairingQrs.read(qr("100.128.0.0"), vpnActive))
        assertEquals(PairingQrRead.Refused(PairingQrProblem.PUBLIC_HOST), PairingQrs.read(qr("8.8.8.8"), vpnActive))
    }

    @Test
    fun manualHostRespectsVpnOptInAndActiveVpn() = runTest {
        var vpnAllowed = false
        var onVpn = false
        val desktop = PairedDesktop("dev-1", "192.168.0.12", 7443, fp, "Studio", "alias-1")
        val store = object : PairedDesktopStore {
            var current: PairedDesktop? = desktop
            override fun load(): PairedDesktop? = current
            override fun save(desktop: PairedDesktop) { current = desktop }
            override fun clear() { current = null }
        }
        val keys = object : DeviceKeys {
            override fun publicKeySpki(): ByteArray = byteArrayOf(1)
            override fun sign(data: ByteArray): ByteArray = byteArrayOf(1)
            override fun delete() {}
        }
        val controller = DesktopSessionController(
            scope = backgroundScope,
            store = store,
            keysFor = { keys },
            linkFor = { _: DesktopTarget, _, _ ->
                object : SessionLink {
                    override val state: StateFlow<SessionState> = MutableStateFlow(SessionState.Opening)
                    override val connectedHost: String? = null
                    override fun connect() {}
                    override fun close() {}
                }
            },
            hostAllowed = { LanAddress.isReachable(it, vpnAllowed = vpnAllowed, onVpn = onVpn) },
        )
        controller.start()

        assertFalse("CGNAT rejected when VPN opt-in is off", controller.setManualHost("100.64.0.1"))
        vpnAllowed = true
        assertFalse("CGNAT rejected when not on TRANSPORT_VPN", controller.setManualHost("100.64.0.1"))
        onVpn = true
        assertTrue("100.64.0.1 accepted with opt-in + TRANSPORT_VPN", controller.setManualHost("100.64.0.1"))
        assertEquals("100.64.0.1", store.current!!.manualHost)
        assertTrue("100.127.255.254 accepted with opt-in + TRANSPORT_VPN", controller.setManualHost("100.127.255.254"))
        assertFalse("100.63.255.255 outside CGNAT rejected", controller.setManualHost("100.63.255.255"))
        assertFalse("100.128.0.0 outside CGNAT rejected", controller.setManualHost("100.128.0.0"))
        assertFalse("public IP rejected", controller.setManualHost("1.1.1.1"))
        controller.stop()
    }

    @Test
    fun settingsCantConnectExposesVpnSwitchOffByDefaultWithLocalizedCopy() {
        assertEquals("Connect over a VPN", catalog("values", "settings_cant_connect_vpn_title"))
        assertEquals("Conectar por VPN", catalog("values-pt-rBR", "settings_cant_connect_vpn_title"))
        assertTrue(catalog("values", "settings_cant_connect_vpn_body")!!.contains("100.64.0.0/10"))
        assertTrue(catalog("values-pt-rBR", "settings_cant_connect_vpn_body")!!.contains("100.64.0.0/10"))

        val values = mutableMapOf<String, String>()
        val prefs = PhonePreferences(object : PreferenceStore {
            override fun getString(key: String): String? = values[key]
            override fun putString(key: String, value: String) { values[key] = value }
        })
        assertFalse("off by default", prefs.connectOverVpn)

        val observed = mutableListOf<Boolean>()
        var toggledVpn = false
        val screen = paparazzi.render(act = { s ->
            if (!toggledVpn) {
                val vpnSwitch = s.merged.firstOrNull { s.role(it) == Role.Switch }
                if (vpnSwitch != null) {
                    toggledVpn = true
                    s.tap(vpnSwitch)
                }
            }
        }) {
            CantConnectSettings(
                connectOverVpn = prefs.connectOverVpn,
                onEnterAddress = {},
                onVpnCheckedChange = { value ->
                    prefs.connectOverVpn = value
                    observed += value
                },
            )
        }

        val vpnSwitch = screen.merged.firstOrNull { screen.role(it) == Role.Switch }
        assertNotNull("VPN switch is rendered in Can't connect?", vpnSwitch)
        assertTrue("VPN switch is at least 48 dp tall", screen.heightDp(vpnSwitch!!) >= 47.5f)
        assertTrue("toggling the switch turns connectOverVpn on", prefs.connectOverVpn)
        assertEquals("onVpnChange callback fired", listOf(true), observed)
        assertEquals("no text is cut in Can't connect?", emptyList<String>(), screen.cutTexts())
    }

    @Test
    fun sessionCoreAndPairingViewModelWireVpnSetting() {
        val core = File("src/main/java/com/oxespace/mobile/session/SessionCore.kt").readText()
        assertTrue("SessionCore passes connectOverVpn to NetworkMonitor", core.contains("NetworkMonitor(app, vpnAllowed = { prefs.connectOverVpn })"))
        assertTrue("SessionCore checks LanAddress.isReachable", core.contains("LanAddress.isReachable(host, vpnAllowed = prefs.connectOverVpn, onVpn = network.onVpn.value)"))
        assertTrue("SessionCore refreshes NetworkMonitor on VPN toggle", core.contains("network.refresh()"))

        val pairingVm = File("src/main/java/com/oxespace/mobile/pairing/PairingViewModel.kt").readText()
        assertTrue("PairingViewModel wires hostAllowed to PairingClient", pairingVm.contains("PairingClient(hostAllowed = hostAllowed)"))
        assertTrue("PairingViewModel wires hostAllowed to PairingFlow", pairingVm.contains("hostAllowed = hostAllowed"))
    }
}
