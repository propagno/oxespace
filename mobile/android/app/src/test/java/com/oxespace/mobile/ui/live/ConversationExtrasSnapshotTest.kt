package com.oxespace.mobile.ui.live

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.android.resources.NightMode
import com.oxespace.mobile.protocol.RemoteQueuedPreview
import com.oxespace.mobile.protocol.RemoteToolDiff
import com.oxespace.mobile.protocol.RemoteToolDiffFile
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeSpace
import com.oxespace.mobile.ui.theme.OxeTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * CCR #509's additions to the conversation screen, each alone, on the generated C5 types: the turn timer working and
 * quiet, the queued messages, and a tool step's diff with a 0/0 file (binary) and a cut patch. Light and dark, English
 * and pt-BR.
 */
@RunWith(Parameterized::class)
class ConversationExtrasSnapshotTest(private val night: Boolean, private val locale: String) {
    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{1}-{0}")
        fun variants() = listOf(arrayOf<Any>(false, "en"), arrayOf<Any>(true, "en"), arrayOf<Any>(false, "pt-rBR"), arrayOf<Any>(true, "pt-rBR"))

        private const val NOW = 50_000_000L
    }

    @get:Rule
    val paparazzi = Paparazzi(
        deviceConfig = DeviceConfig.PIXEL_6.copy(nightMode = if (night) NightMode.NIGHT else NightMode.NOTNIGHT, locale = locale, screenHeight = 1200),
        theme = "android:Theme.Material.NoActionBar",
        maxPercentDifference = 0.1,
    )

    private fun shot(name: String, content: @Composable () -> Unit) =
        paparazzi.snapshot(name) {
            OxeTheme {
                Surface(Modifier.fillMaxSize(), color = Oxe.colors.surfaceCanvas, contentColor = Oxe.colors.textPrimary) {
                    CompositionLocalProvider(LocalClock provides { NOW }) { Column(Modifier.padding(OxeSpace.space4)) { content() } }
                }
            }
        }

    @Test
    fun extras() {
        shot("timer-working") { TurnTimer(TurnClock(turnElapsedMs = 185_000, quietMs = 20_000, receivedAt = NOW)) }
        shot("timer-quiet") { TurnTimer(TurnClock(turnElapsedMs = 720_000, quietMs = 250_000, receivedAt = NOW)) }
        shot("queued") {
            QueuedPreview(listOf(RemoteQueuedPreview("q1", "Also add a test for the expired session"), RemoteQueuedPreview("q2", "And update the changelog when you're done", truncated = true)), queued = 3)
        }
        shot("diff") {
            ToolDiffView(
                RemoteToolDiff(
                    files = listOf(RemoteToolDiffFile("src/auth/session.ts", 12, 3), RemoteToolDiffFile("src/auth/session.test.ts", 40, 0), RemoteToolDiffFile("assets/logo.png", 0, 0)),
                    patch = "@@ -10,3 +10,4 @@\n-  if (expires < now) return null\n+  // seconds, not milliseconds\n+  if (expires * 1000 < now) return null\n   return session",
                    truncated = true,
                ),
            )
        }
    }
}
