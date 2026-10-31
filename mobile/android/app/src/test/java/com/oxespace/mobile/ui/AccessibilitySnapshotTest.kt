package com.oxespace.mobile.ui

import androidx.compose.runtime.CompositionLocalProvider
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import app.cash.paparazzi.accessibility.AccessibilityRenderExtension
import com.oxespace.mobile.protocol.live.LiveStreams
import com.oxespace.mobile.session.DesktopStatus
import com.oxespace.mobile.ui.live.LiveHome
import com.oxespace.mobile.ui.live.RequestScreen
import com.oxespace.mobile.ui.live.ThreadScreen
import com.oxespace.mobile.ui.pairing.PairingScreen
import com.oxespace.mobile.pairing.PairingState
import com.oxespace.mobile.ui.live.LocalClock
import com.oxespace.mobile.ui.theme.OxeTheme
import org.junit.Rule
import org.junit.Test

/**
 * What TalkBack reads, screen by screen: each golden lists every element with its role, label and state next to the
 * picture, so a lost label or a button without a name shows up as a difference. Large text (200 %) checks that
 * nothing is clipped when the person needs bigger letters.
 */
class AccessibilitySnapshotTest {
    @get:Rule
    val paparazzi = Paparazzi(
        deviceConfig = DeviceConfig.PIXEL_6.copy(fontScale = 2.0f),
        theme = "android:Theme.Material.Light.NoActionBar",
        renderExtensions = setOf(AccessibilityRenderExtension()),
        maxPercentDifference = 0.1,
    )

    private val commands = LiveStreams().commands

    @Test
    fun home() = paparazzi.snapshot { OxeTheme { HomeScreen(DesktopStatus.Unreachable(Samples.desktop, 8_000), {}, {}, { true }, {}) } }

    @Test
    fun waitingForTheDesktop() = paparazzi.snapshot { OxeTheme { PairingScreen(PairingState.Waiting("Studio", "28T5CY"), {}, {}) { } } }

    @Test
    fun liveHome() = paparazzi.snapshot {
        OxeTheme { CompositionLocalProvider(LocalClock provides Samples.clock) { LiveHome("Studio", null, Samples.live(), {}, {}, {}, {}, {}) } }
    }

    @Test
    fun conversation() = paparazzi.snapshot { OxeTheme { ThreadScreen("t-1", Samples.timeline(), commands, Samples.presence, connected = true) {} } }

    @Test
    fun riskyRequest() = paparazzi.snapshot { OxeTheme { RequestScreen(Samples.request(risky = true), commands) {} } }
}
