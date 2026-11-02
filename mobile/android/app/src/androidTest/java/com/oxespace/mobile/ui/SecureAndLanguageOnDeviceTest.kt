package com.oxespace.mobile.ui

import com.oxespace.mobile.approval.Presence
import com.oxespace.mobile.approval.PresenceGate
import android.app.LocaleManager
import android.content.res.Resources
import android.os.Build
import android.os.LocaleList
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.oxespace.mobile.MainActivity
import com.oxespace.mobile.R
import com.oxespace.mobile.pairing.PairingState
import com.oxespace.mobile.protocol.RemotePane
import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.live.LiveStreams
import com.oxespace.mobile.protocol.live.ThreadTimeline
import com.oxespace.mobile.protocol.live.TerminalBuffer
import com.oxespace.mobile.session.DesktopStatus
import com.oxespace.mobile.session.LiveRepository
import com.oxespace.mobile.session.Watched
import com.oxespace.mobile.ui.live.LiveHome
import com.oxespace.mobile.ui.live.LiveTab
import com.oxespace.mobile.ui.live.RequestScreen
import com.oxespace.mobile.ui.live.TerminalScreen
import com.oxespace.mobile.ui.live.ThreadScreen
import com.oxespace.mobile.ui.pairing.PairingScreen
import com.oxespace.mobile.ui.theme.OxeTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** M9 on a device: the screens with secrets keep out of Recents and captures, and the app's language is its own. */
@RunWith(AndroidJUnit4::class)
class SecureAndLanguageOnDeviceTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val commands = LiveStreams().commands
    private val request = RemotePendingRequest(
        threadId = "t-1", workspaceId = "w", threadTitle = "Fix login", requestId = "r-1", generation = 1,
        kind = "approval", title = "Delete the build output", command = "rm -rf dist", decisions = listOf("accept", "decline"),
        answerable = true, createdAt = 1,
    )

    private enum class Shown { HOME, LIVE_THREADS, REQUEST, REQUESTS_TAB, THREAD, TERMINAL, SCANNING, VERIFICATION }

    private var shown by mutableStateOf(Shown.HOME)

    private fun secure(): Boolean {
        compose.waitForIdle()
        return compose.activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0
    }

    private fun showAll() = compose.setContent {
        OxeTheme {
            when (shown) {
                Shown.HOME -> HomeScreen(DesktopStatus.Unpaired(), {}, {}, { true }, {})
                // The threads tab lists titles only: an ordinary screen.
                Shown.LIVE_THREADS -> LiveHome("Studio", null, LiveRepository(), {}, {}, {}, {}, {})
                Shown.REQUEST -> RequestScreen(request, commands) {}
                Shown.REQUESTS_TAB -> LiveHome("Studio", null, LiveRepository(), {}, {}, {}, {}, {}, initialTab = LiveTab.REQUESTS)
                Shown.THREAD -> ThreadScreen("t-1", Watched(ThreadTimeline()), commands, PresenceGate { _, _ -> Presence.CONFIRMED }, connected = true) {}
                Shown.TERMINAL -> TerminalScreen(RemotePane("p-1", "zsh", "terminal", phoneWrite = false), Watched(TerminalBuffer()), commands, PresenceGate { _, _ -> Presence.CONFIRMED }) {}
                Shown.SCANNING -> PairingScreen(PairingState.Scanning, {}, {}) {}
                Shown.VERIFICATION -> PairingScreen(PairingState.Waiting("Studio", "28T5CY"), {}, {}) {}
            }
        }
    }

    @After
    fun reset() = CaptureForHomologation.read(false)

    @Test
    fun screensWithSecretsAreSecureAndOnlyWhileShown() {
        showAll()
        assertFalse("home is an ordinary screen", secure())
        shown = Shown.LIVE_THREADS
        assertFalse("the threads list is an ordinary screen", secure())
        shown = Shown.HOME
        // SECURITY #236: every screen that shows a command, output or pairing secret, lists and camera included.
        for (screen in listOf(Shown.REQUEST, Shown.REQUESTS_TAB, Shown.THREAD, Shown.TERMINAL, Shown.SCANNING, Shown.VERIFICATION)) {
            shown = screen
            assertTrue("$screen keeps out of Recents and captures", secure())
            shown = Shown.HOME
            assertFalse("leaving $screen lifts it", secure())
        }
    }

    @Test
    fun onlyADebugBuildCanAllowCaptureForHomologation() {
        assumeTrue("the instrumented app is a debug build", com.oxespace.mobile.BuildConfig.DEBUG)
        CaptureForHomologation.read(true)
        showAll()
        shown = Shown.REQUEST
        assertFalse(secure())
    }

    @Test
    fun theAppsLanguageChangesWithoutTheSystems() {
        assumeTrue("per-app language is Android 13+", Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val locales = context.getSystemService(LocaleManager::class.java)
        val system = Resources.getSystem().configuration.locales.toLanguageTags()
        try {
            locales.applicationLocales = LocaleList.forLanguageTags("pt-BR")
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity { assertEquals("Seu computador no bolso", it.getString(R.string.home_title)) }
            }
            locales.applicationLocales = LocaleList.forLanguageTags("en")
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity { assertEquals("Your desktop, in your pocket", it.getString(R.string.home_title)) }
            }
            assertEquals("the system's language is untouched", system, Resources.getSystem().configuration.locales.toLanguageTags())
        } finally {
            locales.applicationLocales = LocaleList.getEmptyLocaleList()
        }
    }
}
