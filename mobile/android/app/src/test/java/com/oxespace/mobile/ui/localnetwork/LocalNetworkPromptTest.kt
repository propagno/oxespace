package com.oxespace.mobile.ui.localnetwork

import androidx.compose.ui.graphics.Color
import app.cash.paparazzi.Paparazzi
import com.oxespace.mobile.ui.LocalNetworkAsk
import com.oxespace.mobile.ui.LocalNetworkPrompt
import com.oxespace.mobile.pairing.PairingState
import com.oxespace.mobile.ui.f4.Screen
import com.oxespace.mobile.ui.f4.catalog
import com.oxespace.mobile.ui.f4.contrast
import com.oxespace.mobile.ui.f4.f4Paparazzi
import com.oxespace.mobile.ui.f4.render
import com.oxespace.mobile.ui.f4.uiCode
import com.oxespace.mobile.ui.pairing.PairingScreen
import com.oxespace.mobile.ui.theme.Oxe
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.2 Celular A15 (OXE program oxespace-152-mobile, phase F4, Jira OXE-102 / BRD-24 F2,
 * MOB-1: a readable local network screen). Written by the planner; the executor must not edit it.
 *
 * The target is MARCA's approved phone playground in Mandacaru Noite (artefact JpDiD9nKrPrMXdcnkED4US, Celular; the
 * "Acesso à rede local" mock of oxespace-152-brand/.brand-audit/live/celular.html: "Vira um cartão legível com o porquê
 * e o botão na base, com margem"). Where the phone asks today (in the camera's place on the pairing screen, before the
 * scan, and on the whole screen of a paired phone without the permission) the prompt is:
 * - a heading, "Let OXESpace find your computer" (local_network_title), then why the app asks (local_network_needed),
 *   then the line that says nothing leaves the network (local_network_why, "Nothing leaves your network. You can turn
 *   it off in Android settings.");
 * - below them, the button "Allow local network access" (local_network_allow), an OxeButton at least 48 dp tall with
 *   at least 16 dp to each side of the screen, which asks Android (onAllow); under it the note that Android's own
 *   prompt comes next (local_network_next, "Android will show its own prompt next.");
 * - after a refusal: the text that names the permission and the way to the app's settings (onOpenSettings), and no
 *   note about Android's prompt (Android stops asking);
 * - readable in both themes: every text at least 4.5:1 against the app's surfaces (MOB-1 was dark text on the dark
 *   camera box, fixed on main by fb4b1fa2b; this keeps it); nothing under 11 sp (BRD-07). Those two are the guards in
 *   LocalNetworkPromptGuardTest below, green on main.
 * Whether the ask moves after the scan (the mock shows it at step 2, "Reach") is a question to MARCA, not this test.
 *
 * Red at F4 @ origin/main 4fabc30f5: the title is "Local network access", there is no line on what leaves the network
 * and no note on Android's prompt, and the buttons are Material's Button and OutlinedButton.
 */
class LocalNetworkPromptTest {
    @get:Rule
    val paparazzi = f4Paparazzi()

    private val host = PromptHost(paparazzi)

    private fun prompt(ask: LocalNetworkAsk, act: (Screen) -> Unit = {}): Screen = host.render(ask, false, act)

    @Test
    fun thePromptSaysWhyThenAsksThenWhatComesNext() {
        host.allows = 0
        var tapped = false
        val screen = prompt(LocalNetworkAsk.NOT_ASKED) { s -> if (!tapped) s.button(s.string("local_network_allow"))?.let { tapped = true; s.tap(it) } }
        val title = screen.leavesWithText(screen.string("local_network_title")).firstOrNull()
        assertNotNull("the title", title)
        assertTrue("the title is a heading", screen.isHeading(title!!))
        val order = listOf("local_network_title", "local_network_needed", "local_network_why").map { it to screen.top(it) }
        for ((name, top) in order) assertNotNull("\"${screen.string(name)}\" ($name) is on the screen", top)
        val allow = screen.button(screen.string("local_network_allow"))
        assertNotNull("the allow button; buttons: ${screen.buttons().map { screen.describe(it) }}", allow)
        val note = screen.top("local_network_next")
        assertNotNull("the note on Android's prompt", note)
        val tops = order.map { it.second!! } + screen.boundsDp(allow!!).top + note!!
        assertEquals("title, why, nothing leaves the network, the button, the note: top to bottom ($tops)", tops.sorted(), tops)
        val box = screen.boundsDp(allow)
        assertTrue("${screen.describe(allow)} is at least 48 dp tall", screen.heightDp(allow) >= 47.5f)
        assertTrue("the button keeps 16 dp from each side of the screen: $box", box.left >= 15.5f && box.right <= screen.screenWidthDp() - 15.5f)
        assertTrue("the button asks Android (onAllow)", host.allows > 0)

        val denied = prompt(LocalNetworkAsk.DENIED)
        assertTrue("after a refusal there is no note on Android's prompt (Android stops asking)", denied.top("local_network_next") == null)
    }

    @Test
    fun theTargetsWords() {
        val en = mapOf(
            "local_network_title" to "Let OXESpace find your computer",
            "local_network_why" to "Nothing leaves your network. You can turn it off in Android settings.",
            "local_network_next" to "Android will show its own prompt next.",
            "local_network_allow" to "Allow local network access",
        )
        for ((name, words) in en) {
            assertEquals("en $name", words, catalog("values", name))
            val pt = catalog("values-pt-rBR", name)
            assertNotNull("pt-BR $name", pt)
            assertNotEquals("pt-BR $name is translated", words, pt)
        }
    }

    @Test
    fun theButtonsAreTheAppsOwn() {
        // rigor: source-assertion. An OxeButton and Material's Button look alike to TalkBack.
        val code = uiCode("LocalNetworkAccess.kt")
        assertTrue("the prompt's actions are OxeButton", Regex("""(?<![A-Za-z0-9_.])OxeButton\(""").containsMatchIn(code))
        val material = listOf("Button", "OutlinedButton", "TextButton").filter { Regex("""(?<![A-Za-z0-9_.])$it\(""").containsMatchIn(code) }
        assertEquals("no Material buttons in LocalNetworkAccess.kt", emptyList<String>(), material)
    }
}

/**
 * Guards of A15, green on main (not in the criterion's proof): what MOB-1's fix on main (fb4b1fa2b) already gives, kept.
 * Frozen with LocalNetworkPromptTest; the executor must not edit them.
 */
class LocalNetworkPromptGuardTest {
    @get:Rule
    val paparazzi = f4Paparazzi()

    private val host = PromptHost(paparazzi)

    private fun prompt(ask: LocalNetworkAsk, act: (Screen) -> Unit = {}): Screen = host.render(ask, false, act)

    @Test
    fun afterARefusalItNamesTheSettings() {
        host.settings = 0
        var tapped = false
        val screen = prompt(LocalNetworkAsk.DENIED) { s -> if (!tapped) s.button(s.string("local_network_open_settings"))?.let { tapped = true; s.tap(it) } }
        assertTrue("the text names the permission and the way back", screen.leavesWithText(screen.string("local_network_denied")).isNotEmpty())
        val open = screen.button(screen.string("local_network_open_settings"))
        assertNotNull("Open app settings", open)
        assertTrue("${screen.describe(open!!)} is at least 48 dp tall", screen.heightDp(open) >= 47.5f)
        assertTrue("it opens the app's settings (onOpenSettings)", host.settings > 0)
        assertTrue("no allow button after a refusal", screen.button(screen.string("local_network_allow")) == null)
    }

    @Test
    fun readableInBothThemes() {
        for (night in listOf(false, true)) {
            for (ask in LocalNetworkAsk.entries) {
                val screen = host.render(ask, night) {}
                val words = listOf("local_network_title", if (ask == LocalNetworkAsk.NOT_ASKED) "local_network_needed" else "local_network_denied")
                for (name in words) {
                    val node = screen.leavesWithText(screen.string(name)).firstOrNull()
                    assertNotNull("night=$night $ask: \"${screen.string(name)}\"", node)
                    val color = screen.style(node!!)?.color ?: Color.Unspecified
                    assertTrue("night=$night $ask: $name has its own colour", color != Color.Unspecified)
                    for (surface in host.surfaces) {
                        val ratio = contrast(color, surface)
                        assertTrue("night=$night $ask: $name at $ratio:1 on $surface (at least 4.5:1)", ratio >= 4.5f)
                    }
                }
                assertEquals("night=$night $ask: no text under 11 sp", emptyList<Pair<String, Float>>(), screen.textSizes().filter { it.second < 11f })
            }
        }
    }
}

/** The prompt where the pairing screen shows it (the camera's place), counting its two actions. */
private class PromptHost(private val paparazzi: Paparazzi) {
    var allows = 0
    var settings = 0

    /** The app's surfaces of the theme last rendered: the card's and the page's. */
    var surfaces = emptyList<Color>()

    fun render(ask: LocalNetworkAsk, night: Boolean, act: (Screen) -> Unit): Screen = paparazzi.render(night, act) {
        surfaces = listOf(Oxe.colors.surfaceRaised, Oxe.colors.surfaceCanvas)
        PairingScreen(PairingState.Scanning, {}, {}) { modifier -> LocalNetworkPrompt(ask, { allows++ }, { settings++ }, modifier) }
    }
}

/** The top (dp) of the first text leaf that says the string [name], or null when none does. */
private fun Screen.top(name: String): Float? = leavesWithText(string(name)).minOfOrNull { boundsDp(it).top }
