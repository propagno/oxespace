package com.oxespace.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.android.resources.NightMode
import com.oxespace.mobile.pairing.PairingFailure
import com.oxespace.mobile.pairing.PairingState
import com.oxespace.mobile.protocol.live.LiveStreams
import com.oxespace.mobile.protocol.pairing.PairingQrProblem
import com.oxespace.mobile.session.DesktopStatus
import com.oxespace.mobile.ui.live.LiveHome
import com.oxespace.mobile.ui.live.LiveTab
import com.oxespace.mobile.ui.live.RequestScreen
import com.oxespace.mobile.ui.live.TerminalScreen
import com.oxespace.mobile.ui.live.ThreadScreen
import com.oxespace.mobile.ui.pairing.PairingScreen
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.live.LocalClock
import com.oxespace.mobile.ui.theme.OxeTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * Every screen in every state the person can meet, in light and dark, English and Brazilian Portuguese. The goldens
 * live in src/test/snapshots: `./gradlew :app:recordPaparazziDebug` after a deliberate change, and
 * `verifyPaparazziDebug` (CI) fails on any other difference.
 */
@RunWith(Parameterized::class)
class ScreensSnapshotTest(private val night: Boolean, private val locale: String) {
    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{1}-{0}")
        fun variants() = listOf(arrayOf<Any>(false, "en"), arrayOf<Any>(true, "en"), arrayOf<Any>(false, "pt-rBR"), arrayOf<Any>(true, "pt-rBR"))
    }

    @get:Rule
    val paparazzi = Paparazzi(
        deviceConfig = DeviceConfig.PIXEL_6.copy(nightMode = if (night) NightMode.NIGHT else NightMode.NOTNIGHT, locale = locale),
        theme = "android:Theme.Material.NoActionBar",
        maxPercentDifference = 0.1,
    )

    private val commands = LiveStreams().commands

    private fun shot(name: String, content: @Composable () -> Unit) =
        paparazzi.snapshot(name) { OxeTheme { CompositionLocalProvider(LocalClock provides Samples.clock) { content() } } }

    @Test
    fun home() {
        shot("unpaired") { HomeScreen(DesktopStatus.Unpaired(), {}, {}, { true }, {}) }
        shot("revoked") { HomeScreen(DesktopStatus.Unpaired(revokedFrom = "Studio", revoked = true), {}, {}, { true }, {}) }
        shot("connecting") { HomeScreen(DesktopStatus.Connecting(Samples.desktop), {}, {}, { true }, {}) }
        shot("unreachable") { HomeScreen(DesktopStatus.Unreachable(Samples.desktop, 8_000), {}, {}, { true }, {}) }
        shot("offline") { HomeScreen(DesktopStatus.OffNetwork(Samples.desktop), {}, {}, { true }, {}) }
        shot("incompatible") { HomeScreen(DesktopStatus.Incompatible(Samples.desktop), {}, {}, { true }, {}) }
    }

    @Test
    fun pairing() {
        val camera: @Composable (androidx.compose.ui.Modifier) -> Unit = { modifier -> Box(modifier.background(Oxe.colors.surfaceInverse)) }
        shot("scanning") { PairingScreen(PairingState.Scanning, {}, {}, camera) }
        shot("bad-code") { PairingScreen(PairingState.BadCode(PairingQrProblem.PUBLIC_HOST), {}, {}, camera) }
        shot("waiting") { PairingScreen(PairingState.Waiting("Studio", "28T5CY"), {}, {}, camera) }
        shot("paired") { PairingScreen(PairingState.Paired(Samples.desktop), {}, {}, camera) }
        shot("wrong-certificate") { PairingScreen(PairingState.Failed(PairingFailure.WRONG_CERTIFICATE), {}, {}, camera) }
    }

    @Test
    fun live() {
        for (tab in LiveTab.entries) {
            shot("live-${tab.name.lowercase()}") { LiveHome("Studio", null, Samples.live(), commands, {}, { _, _ -> }, {}, {}, {}, initialTab = tab) }
        }
        shot("live-empty") { LiveHome("Studio", null, Samples.live(empty = true), commands, {}, { _, _ -> }, {}, {}, {}) }
        shot("live-reconnecting") { LiveHome("Studio", "Connection to Studio lost. Reconnecting…", Samples.live(), commands, {}, { _, _ -> }, {}, {}, {}) }
    }

    @Test
    fun conversation() {
        shot("thread") { ThreadScreen("t-1", Samples.timeline(), commands, Samples.presence, connected = true) {} }
        shot("thread-loading") { ThreadScreen("t-1", Samples.timeline(loaded = false), commands, Samples.presence, connected = true) {} }
    }

    @Test
    fun terminal() {
        shot("terminal-typing") { TerminalScreen(Samples.pane, Samples.terminal(), commands, Samples.presence) {} }
        shot("terminal-read-only") { TerminalScreen(Samples.readOnlyPane, Samples.terminal(), commands, Samples.presence) {} }
        shot("terminal-loading") { TerminalScreen(Samples.readOnlyPane, Samples.terminal(loaded = false), commands, Samples.presence) {} }
    }

    @Test
    fun requests() {
        shot("request-risky") { RequestScreen(Samples.request(risky = true), commands) {} }
        shot("request-question") { RequestScreen(Samples.request(risky = false), commands) {} }
        shot("request-desktop-only") { RequestScreen(Samples.request().copy(answerable = false), commands) {} }
        shot("request-gone") { RequestScreen(null, commands) {} }
    }
}
