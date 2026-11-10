package com.oxespace.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.android.resources.NightMode
import com.oxespace.mobile.agents.AgentState
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * Frozen acceptance test for 1.5.0 CR-A42 (A42, OXE program, phase F10). Written by the planner; the executor must not
 * edit it. The components of the approved design #627 (playground/HANDOFF-MOBILE.md "Components"), each in its states,
 * in light and dark. The goldens live in src/test/snapshots: the CR-A42 task records them with
 * `./gradlew :app:recordPaparazziDebug`, and DESIGN reviews them at the promote (A70, V-lines evidence).
 *
 * Red at A42 (0969c14b): the components don't exist yet; with the CR-A42 skeleton they render TODO("F10 CR-A42"), and
 * until their goldens are recorded, verifyPaparazziDebug fails on the missing images.
 */
@RunWith(Parameterized::class)
class ComponentsSnapshotTest(private val night: Boolean) {
    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "night={0}")
        fun variants() = listOf(arrayOf<Any>(false), arrayOf<Any>(true))
    }

    @get:Rule
    val paparazzi = Paparazzi(
        deviceConfig = DeviceConfig.PIXEL_6.copy(nightMode = if (night) NightMode.NIGHT else NightMode.NOTNIGHT),
        theme = "android:Theme.Material.NoActionBar",
        maxPercentDifference = 0.1,
    )

    private fun shot(name: String, content: @Composable () -> Unit) = paparazzi.snapshot(name) {
        OxeTheme(darkTheme = night) {
            Column(Modifier.fillMaxWidth().background(Oxe.colors.surfaceCanvas).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                content()
            }
        }
    }

    @Test
    fun statusGlyph() = shot("status-glyph") {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            for (state in AgentState.entries) StatusGlyph(state)
        }
    }

    @Test
    fun providerAvatar() = shot("provider-avatar") {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            for (provider in listOf("claude", "codex", "something-new")) ProviderAvatar(provider)
            for (provider in listOf("claude", "codex")) ProviderAvatar(provider, size = 22.dp)
        }
    }

    @Test
    fun oxeButton() = shot("oxe-button") {
        for (kind in OxeButtonKind.entries) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OxeButton(kind.name.lowercase().replaceFirstChar { it.uppercase() }, onClick = {}, kind = kind)
                OxeButton("Disabled", onClick = {}, kind = kind, enabled = false)
            }
        }
    }

    @Test
    fun notice() = shot("notice") {
        for (intent in NoticeIntent.entries) {
            Notice(intent, title = "Title for ${intent.name.lowercase()}", text = "One or two lines that explain what happened and what to do next.")
        }
        Notice(
            NoticeIntent.WARNING,
            title = "Can't reach Studio",
            text = "Check that both are on the same Wi-Fi.",
            actions = listOf(NoticeAction("Try again") {}, NoticeAction("Pair again") {}),
        )
    }

    @Test
    fun emptyState() = shot("empty-state") {
        EmptyState(title = "Nothing needs you", text = "Requests from your agents show up here.")
        EmptyState(title = "No longer waiting", text = "This request was answered on the computer.", action = NoticeAction("Back to requests") {})
    }
}
