package com.oxespace.mobile.ui.live

import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import com.oxespace.mobile.R
import com.oxespace.mobile.ui.F3Live
import com.oxespace.mobile.ui.PhoneScale
import com.oxespace.mobile.ui.RenderedScreen
import com.oxespace.mobile.ui.phonePaparazzi
import com.oxespace.mobile.ui.render
import com.oxespace.mobile.ui.theme.OxeFonts
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.2 Celular A8 v2 (OXE program oxespace-152-mobile, phase F3, Jira OXE-102 / BRD-24 F1,
 * CA-1, CA-2, CA-3; CR-F3-2: the coordination's and MARCA's corrections of 14/11). Written by the planner; the executor
 * must not edit it.
 *
 * The connected home as the approved playground (Mandacaru Noite, MARCA artefact JpDiD9nKrPrMXdcnkED4US, Celular):
 * - CA-3: the queue tab (LiveTab.REQUESTS) is the first tab of the bottom bar and the tab the home opens on. Its label is
 *   live_tabs_requests, "Pedidos" / "Requests": a tab names a place, never a state (no tab says a state word); its count
 *   is the ochre badge (attnBg / attnFg), read with the tab (live_requests_badge);
 * - CA-1: the header shows the symbol (OxeMark), the computer's name as the heading, the connection line, and a gear: an
 *   icon button labelled live_menu_settings ("Configurações") that opens the phone's Settings in one tap (onSettings),
 *   at least 48 x 48 dp;
 * - CA-2: each conversation row has three floors, measured by BRD-07's roles: (1) the title in bodyMedium at 600
 *   (13 sp, weight 600) with the time on the right in labelSmall (11 sp), mono, tabular figures ("tnum"); (2) the
 *   provider's avatar (ProviderAvatar at 14 dp, radius OxeRadius.sm, one node read as the provider's name: its letter is
 *   not a text node of its own), the workspace and the state word in labelMedium (12 sp); (3) only when the conversation
 *   needs you, what it asks (the pending request's title, requestTitle) in labelMedium (12 sp, attnFg); with the state
 *   sign (StatusGlyph) in front; the time is the short age of thread.updatedAt ("3 min", "agora", or "HH:mm" today);
 * - the state words are the brand's one name per state (Precisa de você, Trabalhando, Ocioso, Falhou, Concluído): a
 *   conversation whose last turn completed says "Concluído" (live_agent_state_done; pt-BR said "Terminou").
 * BRD-07 (OXE-69): no text under 11 sp (the bottom bar's autosize floor goes from 7 sp to at least 11 sp), radii only
 * OxeRadius in LiveHome.kt and ProviderAvatar.kt, colours by token in both themes.
 *
 * Red at F3 @ origin/main f417a86f0: "Conversas" is the first tab and the home opens on it; Settings sits inside the
 * "Mais opções" menu; rows have no time and no third floor (16 sp titles, an 18 dp avatar whose letter is 10 sp);
 * LiveHome.kt has minFontSize = 7.sp; ProviderAvatar's radius is size * 0.28; pt-BR's finished state is "Terminou".
 */
class LiveHomeLayoutTest {
    @get:Rule
    val paparazzi = phonePaparazzi()

    private var settings = 0

    private fun home(initial: LiveTab? = null, act: (RenderedScreen) -> Unit = {}): RenderedScreen = paparazzi.render(act = act) {
        val live = F3Live.live(F3Live.APPROVAL)
        if (initial == null) {
            LiveHome("Studio", null, live, {}, {}, {}, {}, {}, onSettings = { settings++ })
        } else {
            LiveHome("Studio", null, live, {}, {}, {}, {}, {}, initialTab = initial, onSettings = { settings++ })
        }
    }

    private fun xml(dir: String, name: String) =
        Regex("""<string name="$name">([^<]*)</string>""").find(File("src/main/res/$dir/strings.xml").readText())?.groupValues?.get(1)

    @Test
    fun theQueueIsTheFirstTabAndTheHomeOpensOnIt() {
        val screen = home()
        val tabs = screen.merged.filter { screen.role(it) == Role.Tab }.sortedBy { screen.boundsDp(it).left }
        assertTrue("the bottom bar has its five tabs: ${tabs.map { screen.label(it) }}", tabs.size == 5)
        val queue = screen.string("live_tabs_requests")
        assertTrue("the first tab is \"$queue\"; tabs: ${tabs.map { screen.label(it) }}", screen.label(tabs.first()).contains(queue))
        assertTrue("the home opens on the queue: the first tab is the selected one", screen.selected(tabs.first()))
        val waiting = screen.context.resources.getQuantityString(R.plurals.live_requests_badge, 1, 1)
        assertEquals("the queue's count is read with its tab", waiting, screen.stateDescription(tabs.first()))
        // rigor: source-assertion. The badge's colour is not in the semantics: the ochre of the sun.
        assertTrue("the count badge is ochre (attnBg / attnFg)", Regex("""Badge\([^)]*attnBg[^)]*attnFg""").containsMatchIn(PhoneScale.code("live/LiveHome.kt")))
    }

    @Test
    fun aTabNamesAPlaceAndTheStateWordsAreTheBrands() {
        assertEquals("Pedidos", xml("values-pt-rBR", "live_tabs_requests"))
        assertEquals("Requests", xml("values", "live_tabs_requests"))
        assertEquals("Concluído", xml("values-pt-rBR", "live_agent_state_done"))
        assertEquals("Finished", xml("values", "live_agent_state_done"))
        val screen = home()
        val states = listOf("live_agent_state_blocked", "live_agent_state_working", "live_agent_state_idle", "live_agent_state_done", "live_status_failed", "thread_state_needs_you")
            .map { screen.string(it) }.toSet()
        val tabs = screen.merged.filter { screen.role(it) == Role.Tab }.map { screen.label(it).trim() }
        assertTrue("no tab is named by a state word: tabs $tabs, states $states", tabs.none { tab -> states.any { tab.startsWith(it) } })
    }

    @Test
    fun theHeaderHasTheComputerTheConnectionAndAGearToSettings() {
        fun RenderedScreen.gear() = string("live_menu_settings").let { wanted -> buttons().firstOrNull { label(it).trim() == wanted } }
        val screen = home(LiveTab.THREADS) { it.tap(it.gear()) }
        assertTrue("the computer's name is the heading", screen.leaves.any { screen.text(it) == "Studio" && screen.isHeading(it) })
        assertTrue("the connection line", screen.leavesWithText(screen.string("live_connected_hint")).isNotEmpty())
        val gear = screen.gear()
        assertNotNull("a gear button \"${screen.string("live_menu_settings")}\" in the header; buttons: ${screen.buttons().map { screen.describe(it) }}", gear)
        assertTrue("${screen.describe(gear!!)} is at least 48 dp", screen.widthDp(gear) >= 47.5f && screen.heightDp(gear) >= 47.5f)
        assertTrue("a tap on the gear opens Settings, with no menu in between", settings > 0)
        assertTrue("the header draws the symbol (OxeMark): rigor source-assertion", Regex("""(?<![A-Za-z0-9_.])OxeMark\(""").containsMatchIn(PhoneScale.code("live/LiveHome.kt")))
    }

    @Test
    fun aConversationRowHasThreeFloorsWithTheTime() {
        val screen = home(LiveTab.THREADS)
        val title = screen.leavesWithText("Fix the login redirect").singleOrNull()
        assertNotNull("the row's title", title)
        val titleBox = screen.boundsDp(title!!)
        val time = screen.leaves.firstOrNull { node ->
            val box = screen.boundsDp(node)
            Regex("""^(\d+ min|agora|\d{1,2}:\d{2})$""").matches(screen.text(node).trim()) && box.top < titleBox.bottom && box.bottom > titleBox.top && box.left > titleBox.left
        }
        assertNotNull("the time (\"3 min\") on the title's floor, at its right; texts: ${screen.leaves.map { screen.text(it) }.filter { it.isNotBlank() }}", time)
        val providers = screen.leaves.filter { screen.label(it).trim() == "Claude" && screen.boundsDp(it).top >= titleBox.bottom - 1f }
        assertTrue("floor 2: the provider", providers.isNotEmpty())
        assertTrue(
            "floor 2: the provider's avatar is 14 dp; nodes: ${providers.map { screen.describe(it) }}",
            providers.any { kotlin.math.abs(screen.widthDp(it) - 14f) <= 0.5f && kotlin.math.abs(screen.heightDp(it) - 14f) <= 0.5f },
        )
        val workspace = screen.leavesWithText("oxespace").firstOrNull { screen.boundsDp(it).top >= titleBox.bottom - 1f }
        assertNotNull("floor 2: the workspace", workspace)
        val second = screen.boundsDp(workspace!!)
        val asks = screen.leavesWithText(screen.string("request_kind_agent")).firstOrNull { screen.boundsDp(it).top >= second.bottom - 1f }
        assertNotNull("floor 3: what it asks (\"${screen.string("request_kind_agent")}\")", asks)
        val titleStyle = screen.style(title)!!
        assertEquals("the title is BRD-07's bodyMedium, 13 sp", 13f, titleStyle.fontSize.value, 0.01f)
        assertEquals("the title is weight 600", FontWeight(600), titleStyle.fontWeight)
        val timeStyle = screen.style(time!!)!!
        assertEquals("the time is labelSmall, 11 sp", 11f, timeStyle.fontSize.value, 0.01f)
        assertEquals("the time is mono", OxeFonts.mono, timeStyle.fontFamily)
        assertTrue("the time has tabular figures (tnum): ${timeStyle.fontFeatureSettings}", timeStyle.fontFeatureSettings.orEmpty().contains("tnum"))
        for (node in listOf(workspace, asks!!)) {
            assertEquals("\"${screen.text(node)}\" is labelMedium, 12 sp", 12f, screen.style(node)!!.fontSize.value, 0.01f)
        }
        val idle = screen.leavesWithText("Add tests for the gateway").single()
        val idleRow = screen.boundsDp(idle)
        assertTrue(
            "a conversation that does not need you has no third floor",
            screen.leavesWithText(screen.string("request_kind_agent")).none { screen.boundsDp(it).top in idleRow.top..(idleRow.top + 80f) },
        )
        val finished = screen.string("live_agent_state_done")
        assertTrue(
            "a conversation whose last turn completed says \"$finished\" on its floor 2",
            screen.leaves.any { screen.text(it).trim() == finished && screen.boundsDp(it).top in (idleRow.bottom - 1f)..(idleRow.top + 80f) },
        )
    }

    @Test
    fun theHomeFollowsThePhoneScale() {
        assertEquals("BRD-07 in LiveHome.kt", emptyList<String>(), PhoneScale.offenders("live/LiveHome.kt"))
        assertEquals("BRD-07 in ProviderAvatar.kt", emptyList<String>(), PhoneScale.offenders("components/ProviderAvatar.kt"))
        assertTrue("the avatar's radius is OxeRadius.sm", PhoneScale.code("components/ProviderAvatar.kt").contains("RoundedCornerShape(OxeRadius.sm)"))
        for (tab in listOf(LiveTab.THREADS, LiveTab.REQUESTS)) {
            val small = home(tab).textSizes().filter { it.second < 11f }
            assertEquals("no text under 11 sp on $tab", emptyList<Pair<String, Float>>(), small)
        }
    }
}
