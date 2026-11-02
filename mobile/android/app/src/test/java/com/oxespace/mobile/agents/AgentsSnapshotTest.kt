package com.oxespace.mobile.agents

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.android.resources.NightMode
import com.oxespace.mobile.ui.live.LocalClock
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * The Agents tab (S7.4, draft on CCR #513) in each state the person can meet, light and dark, English and Brazilian
 * Portuguese, on the fake rows (sampleAgents): one per state, every kind, a risky answerable request and one only the
 * computer can answer.
 */
@RunWith(Parameterized::class)
class AgentsSnapshotTest(private val night: Boolean, private val locale: String) {
    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{1}-{0}")
        fun variants() = listOf(arrayOf<Any>(false, "en"), arrayOf<Any>(true, "en"), arrayOf<Any>(false, "pt-rBR"), arrayOf<Any>(true, "pt-rBR"))

        private const val NOW = 100_000_000L
    }

    @get:Rule
    val paparazzi = Paparazzi(
        deviceConfig = DeviceConfig.PIXEL_6.copy(nightMode = if (night) NightMode.NIGHT else NightMode.NOTNIGHT, locale = locale),
        theme = "android:Theme.Material.NoActionBar",
        maxPercentDifference = 0.1,
    )

    private fun shot(name: String, content: @Composable () -> Unit) =
        // Hosted the way LiveHome's Scaffold hosts it: the canvas behind, the primary text colour for its content.
        paparazzi.snapshot(name) {
            OxeTheme {
                Surface(color = Oxe.colors.surfaceCanvas, contentColor = Oxe.colors.textPrimary) {
                    CompositionLocalProvider(LocalClock provides { NOW }) { content() }
                }
            }
        }

    private fun loaded(unavailable: List<String> = emptyList()) = AgentsState(sampleAgents(NOW), unavailable, loaded = true)

    @Composable
    private fun Screen(state: AgentsState, filter: AgentFilter = AgentFilter.ALL, connected: Boolean = true) =
        AgentsScreen("Studio", state, filter, connected, {}, { tapTarget(it) }, {}, {}, { _, _ -> })

    @Test
    fun agents() {
        shot("agents-all") { Screen(loaded()) }
        shot("agents-needs-you") { Screen(loaded(), AgentFilter.NEEDS_YOU) }
        shot("agents-partial") { Screen(loaded(unavailable = listOf("work"))) }
        shot("agents-offline") { Screen(loaded(), connected = false) }
        shot("agents-loading") { Screen(AgentsState()) }
        shot("agents-empty") { Screen(AgentsState(loaded = true)) }
        shot("agents-filter-empty") { Screen(AgentsState(sampleAgents(NOW).filter { it.kind != "pane" }, loaded = true), AgentFilter.TERMINALS) }
    }
}
