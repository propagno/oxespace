package com.oxespace.mobile.ui.live

import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import app.cash.paparazzi.Snapshot
import app.cash.paparazzi.SnapshotHandler
import com.android.resources.Density
import com.android.resources.NightMode
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.live.LiveStreams
import com.oxespace.mobile.ui.F3Live
import com.oxespace.mobile.ui.PhoneScale
import com.oxespace.mobile.ui.render
import java.awt.image.BufferedImage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * OXE-164 (CA-2, CA-3, RN-1, RN-2, RT-2): verifies the critical queue card header and RequestScreen heading with
 * desktop-authored `desktopImpactSummary` and catalog fallback across both themes (light/dark), both locales
 * (`pt-rBR`/`en`), and two Compose densities/font scales, preserving BRD-24 scale and OxeRadius tokens.
 */
@RunWith(Parameterized::class)
class NeedsYouCriticalImpactTest(
    private val night: Boolean,
    private val locale: String,
    private val density: Density,
    private val fontScale: Float,
) {
    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{1}-night={0}-{2}-scale={3}")
        fun variants() = listOf(
            arrayOf<Any>(false, "pt-rBR", Density.XXHIGH, 1.0f),
            arrayOf<Any>(true, "pt-rBR", Density.XXHIGH, 1.0f),
            arrayOf<Any>(false, "pt-rBR", Density.XHIGH, 1.3f),
            arrayOf<Any>(true, "pt-rBR", Density.XHIGH, 1.3f),
            arrayOf<Any>(false, "en", Density.XXHIGH, 1.0f),
            arrayOf<Any>(true, "en", Density.XXHIGH, 1.0f),
            arrayOf<Any>(false, "en", Density.XHIGH, 1.3f),
            arrayOf<Any>(true, "en", Density.XHIGH, 1.3f),
        )
    }

    private object DropFrames : SnapshotHandler {
        override fun newFrameHandler(snapshot: Snapshot, frameCount: Int, fps: Int): SnapshotHandler.FrameHandler =
            object : SnapshotHandler.FrameHandler {
                override fun handle(image: BufferedImage) = Unit
                override fun close() = Unit
            }

        override fun close() = Unit
    }

    @get:Rule
    val paparazzi = Paparazzi(
        deviceConfig = DeviceConfig.PIXEL_6.copy(
            nightMode = if (night) NightMode.NIGHT else NightMode.NOTNIGHT,
            locale = locale,
            density = density,
            fontScale = fontScale,
        ),
        theme = "android:Theme.Material.NoActionBar",
        snapshotHandler = DropFrames,
    )

    private fun criticalJson(summary: String?, title: String = "LIMPAR CACHE"): String {
        val summaryField = summary?.let { ""","desktopImpactSummary":"$it"""" } ?: ""
        return """{"threadId":"t-1","workspaceId":"w-1","threadTitle":"Fix the login redirect","requestId":"r-1","generation":3,"kind":"approval",
            "title":"$title","command":"docker volume rm pix-mock-data","cwd":".","toolName":"Bash","risk":"critical"$summaryField,
            "decisions":["accept","decline"],"answerable":true,"createdAt":1}"""
    }

    @Test
    fun criticalQueueCardRendersDesktopImpactSummaryAndPreservesBrd24Scale() {
        val summary = if (locale == "pt-rBR") "Remover um volume" else "Remove a volume"
        val expectedHeader = if (locale == "pt-rBR") "CRÍTICO · REMOVER UM VOLUME" else "CRITICAL · REMOVE A VOLUME"
        val screen = paparazzi.render(night = night) {
            LiveHome(
                desktopName = "Studio",
                banner = null,
                live = F3Live.live(criticalJson(summary)),
                onOpenThread = {},
                onOpenRequest = {},
                onOpenTerminal = {},
                onEnterAddress = {},
                onUnpair = {},
                initialTab = LiveTab.REQUESTS,
            )
        }
        val header = screen.leavesWithText(expectedHeader).singleOrNull()
        assertNotNull("critical header \"$expectedHeader\"; texts=${screen.leaves.map { screen.text(it) }.filter { it.isNotBlank() }}", header)
        assertTrue("header text size >= 11 sp", screen.style(header!!)!!.fontSize.value >= 11f)
        assertEquals("0 occurrences of hostile agent title", 0, screen.leaves.count { screen.text(it).contains("LIMPAR CACHE", ignoreCase = true) })
        assertEquals("no text under 11 sp", emptyList<Pair<String, Float>>(), screen.textSizes().filter { it.second < 11f })
        assertEquals("BRD-24 / BRD-07 scale and OxeRadius in NeedsYou.kt", emptyList<String>(), PhoneScale.offenders("live/NeedsYou.kt"))

        // Critical queue card still offers only Review, never Allow or Deny.
        val buttons = screen.buttons().map { screen.label(it).trim() }
        assertTrue("Review button present; buttons=$buttons", screen.string("thread_review") in buttons)
        assertTrue("No Allow on critical queue card; buttons=$buttons", screen.string("request_decision_accept") !in buttons)
        assertTrue("No Deny on critical queue card; buttons=$buttons", screen.string("request_decision_decline") !in buttons)
    }

    @Test
    fun criticalQueueCardFallsBackToCatalogWhenSummaryAbsentOrBlank() {
        val expectedFallback = if (locale == "pt-rBR") "CRÍTICO · APROVAR COMANDO" else "CRITICAL · APPROVE COMMAND"
        for (summary in listOf(null, "", "   ")) {
            val screen = paparazzi.render(night = night) {
                LiveHome(
                    desktopName = "Studio",
                    banner = null,
                    live = F3Live.live(criticalJson(summary)),
                    onOpenThread = {},
                    onOpenRequest = {},
                    onOpenTerminal = {},
                    onEnterAddress = {},
                    onUnpair = {},
                    initialTab = LiveTab.REQUESTS,
                )
            }
            assertTrue(
                "fallback critical header \"$expectedFallback\" for summary=$summary",
                screen.leavesWithText(expectedFallback).isNotEmpty(),
            )
            assertEquals("0 occurrences of hostile agent title", 0, screen.leaves.count { screen.text(it).contains("LIMPAR CACHE", ignoreCase = true) })
        }
    }

    @Test
    fun criticalRequestScreenShowsDesktopImpactSummaryBelowRiskChip() {
        val summary = if (locale == "pt-rBR") "Remover um volume" else "Remove a volume"
        val request = RemoteFrames.json.decodeFromString(RemotePendingRequest.serializer(), criticalJson(summary))
        val screen = paparazzi.render(night = night) {
            RequestScreen(request, LiveStreams().commands) {}
        }
        val badge = screen.string("request_risk_badge", screen.string("request_risk_critical"))
        val chip = screen.merged.firstOrNull { screen.label(it).trim() == badge }
        val heading = screen.merged.firstOrNull { screen.isHeading(it) && screen.text(it).trim() == summary }
        assertNotNull("RiskChip \"$badge\"", chip)
        assertNotNull("desktop impact summary heading \"$summary\"", heading)
        assertTrue("RiskChip sits above heading", screen.boundsDp(chip!!).bottom <= screen.boundsDp(heading!!).top + 1f)
        val fromAgentNode = screen.leavesWithText(screen.string("request_from_agent")).first()
        val headerAndFacts = screen.leaves.filter { screen.boundsDp(it).bottom <= screen.boundsDp(fromAgentNode).top + 1f }
        assertEquals(
            "0 occurrences of hostile agent title in RequestScreen risk header",
            0,
            headerAndFacts.count { screen.text(it).contains("LIMPAR CACHE", ignoreCase = true) },
        )
    }
}
