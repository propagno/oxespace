package com.oxespace.mobile.ui.settings

import androidx.compose.ui.semantics.Role
import app.cash.paparazzi.Paparazzi
import com.oxespace.mobile.approval.CRITICAL_ALLOW_HOLD_MS
import com.oxespace.mobile.notify.AlertKind
import com.oxespace.mobile.settings.PhonePreferences
import com.oxespace.mobile.settings.PreferenceStore
import com.oxespace.mobile.settings.ThemeChoice
import com.oxespace.mobile.ui.f4.Screen
import com.oxespace.mobile.ui.f4.Shown
import com.oxespace.mobile.ui.f4.catalog
import com.oxespace.mobile.ui.f4.f4Paparazzi
import com.oxespace.mobile.ui.f4.render
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.2 Celular A13 (OXE program oxespace-152-mobile, phase F4, Jira OXE-102 / BRD-24 F2,
 * MOB-3: Settings in 7 sections). Written by the planner; the executor must not edit it.
 *
 * The target is MARCA's approved phone playground in Mandacaru Noite (artefact JpDiD9nKrPrMXdcnkED4US, Celular; the
 * Settings mock of oxespace-152-brand/.brand-audit/live/celular.html): seven cards, in this order, each with its icon:
 * (1) the computer (its name, how it is connected, and Unpair this phone); (2) Answers / Respostas: "Fingerprint or
 * screen lock", asked on every answer, shown as "Always", a safety rule and never a switch, and "Critical requests",
 * whose Allow unlocks after the request screen's hold (CRITICAL_ALLOW_HOLD_MS, 2 s), a number the text takes from the
 * app and never writes by hand; (3) Notifications / Notificações, one switch per kind; (4) Appearance / Aparência, the
 * theme as System, Light, Dark / Sistema, Claro, Escuro ("Igual ao do celular" was cut); (5) Typing in terminals /
 * Digitação nos terminais, a row whose only text under the title is "Tamanho do texto" (terminal_text_size: the text
 * size is the one typing setting the phone has, so the key bar is not named); (6) Can't connect? / Não consegue
 * conectar?; (7) About / Sobre. (5) and (6) are rows you can open (a chevron), each at least 48 dp tall; what they open
 * leaves the top page: the terminal text size choice (Pequeno, Médio, Grande) and "Informar o endereço do computador"
 * are no longer on it. Nothing on
 * the page is cut (no ellipsis, no line beyond maxLines) in pt-BR. Section words: MARCA's mock (en) and its caption
 * (pt-BR), and MARCA's answers of 15/11 (Q-M1 to Q-M4, via the coordination). At the largest system font (2.0) nothing is cut either: SettingsSectionsTestAtTheLargestFont below. The
 * guards (nothing cut at the default font, Notifications, Appearance, the computer card: green on main) are
 * SettingsSectionsGuardTest below.
 *
 * New strings, read by name: settings_answers_title, settings_answers_presence, settings_answers_presence_body,
 * settings_answers_always, settings_answers_critical, settings_answers_critical_body (with %1$d, the seconds),
 * settings_typing_title, settings_cant_connect_title. Changed: settings_theme_title (Theme -> Appearance / Tema ->
 * Aparência) and settings_theme_system (Same as the phone -> System / Igual ao do celular -> Sistema). The pages the
 * two rows open use only existing strings (Q-M1) and are not read here: one frame is laid out, a tap does not redraw.
 * The computer card shows what the phone knows (Q-M4): the name, the connection line and Unpair; the OS and the
 * pairing date are a 1.5.3 divergence.
 *
 * Approval safety: the Answers card has no switch, no toggle and no tap target: the fingerprint or screen lock on every
 * answer is a rule the phone states, not a preference.
 *
 * Red at F4 @ origin/main 4fabc30f5: Settings has the sections Computer, Theme, Notifications, terminal text size and
 * About; there is no Answers, Typing in terminals or Can't connect?; at the largest font the theme's "Igual ao do
 * celular" is cut by its third of the row.
 */
class SettingsSectionsTest {
    @get:Rule
    val paparazzi = f4Paparazzi()

    private val page = SettingsPage(paparazzi)

    private fun settings(act: (Screen) -> Unit = {}): Screen = page.render(act)

    @Test
    fun theSevenSectionsInTheTargetsOrder() {
        val screen = settings()
        val computer = screen.leavesWithText("Studio").minByOrNull { screen.boundsDp(it).top }
        assertNotNull("(1) the computer card names the paired computer", computer)
        val tops = mutableListOf("Studio" to screen.boundsDp(computer!!).top)
        for (name in SECTION_NAMES) {
            val node = screen.titled(name)
            assertNotNull("the section \"${screen.string(name)}\" ($name); texts: ${screen.leaves.map { screen.text(it) }.filter { it.isNotBlank() }}", node)
            tops += screen.string(name) to screen.boundsDp(node!!).top
        }
        assertEquals("the seven sections top to bottom: $tops", tops.sortedBy { it.second }.map { it.first }, tops.map { it.first })
        for (name in listOf("settings_answers_title", "settings_alerts_title", "settings_theme_title")) {
            assertTrue("\"${screen.string(name)}\" heads its card (a heading for TalkBack)", screen.isHeading(screen.titled(name)!!))
        }
    }

    @Test
    fun theSectionsUseTheTargetsWords() {
        val en = mapOf(
            "settings_answers_title" to "Answers",
            "settings_alerts_title" to "Notifications",
            "settings_theme_title" to "Appearance",
            "settings_typing_title" to "Typing in terminals",
            "settings_cant_connect_title" to "Can't connect?",
            "settings_about_title" to "About",
            "settings_theme_system" to "System",
            "settings_answers_presence" to "Fingerprint or screen lock",
            "settings_answers_presence_body" to "Asked on every answer. A safety rule.",
            "settings_answers_always" to "Always",
            "settings_answers_critical" to "Critical requests",
            "settings_answers_critical_body" to "Allow unlocks after %1${'$'}d s.",
        )
        val pt = mapOf(
            "settings_answers_title" to "Respostas",
            "settings_alerts_title" to "Notificações",
            "settings_theme_title" to "Aparência",
            "settings_typing_title" to "Digitação nos terminais",
            "settings_cant_connect_title" to "Não consegue conectar?",
            "settings_about_title" to "Sobre",
            "settings_theme_system" to "Sistema",
            "settings_answers_presence" to "Digital ou bloqueio de tela",
            "settings_answers_presence_body" to "Pedido a cada resposta. Uma regra de segurança.",
            "settings_answers_always" to "Sempre",
            "settings_answers_critical" to "Pedidos críticos",
            "settings_answers_critical_body" to "Permitir libera depois de %1${'$'}d s.",
        )
        for ((name, word) in en) assertEquals("en $name", word, catalog("values", name))
        for ((name, word) in pt) assertEquals("pt-BR $name", word, catalog("values-pt-rBR", name))
    }

    @Test
    fun answersStateTheSafetyRulesAndCannotBeSwitchedOff() {
        val screen = settings()
        val answers = screen.titled("settings_answers_title")
        val alerts = screen.titled("settings_alerts_title")
        assertNotNull("the Answers card", answers)
        assertNotNull("the Notifications card", alerts)
        val top = screen.boundsDp(answers!!).top
        val bottom = screen.boundsDp(alerts!!).top
        fun inCard(node: Shown) = screen.boundsDp(node).top >= top - 1f && screen.boundsDp(node).bottom <= bottom + 1f
        for (name in listOf("settings_answers_presence", "settings_answers_presence_body", "settings_answers_always", "settings_answers_critical")) {
            assertTrue("\"${screen.string(name)}\" is in the Answers card", screen.leavesWithText(screen.string(name)).any(::inCard))
        }
        val seconds = (CRITICAL_ALLOW_HOLD_MS / 1000L).toInt()
        val critical = screen.string("settings_answers_critical_body", seconds)
        assertTrue("\"$critical\" (the request screen's $seconds s) is in the Answers card", screen.leavesWithText(critical).any(::inCard))
        val controls = screen.merged.filter { inCard(it) && (screen.toggles(it) || screen.clickable(it)) }
        assertEquals("nothing in the Answers card can be switched or tapped: a safety rule, not a preference", emptyList<String>(), controls.map { screen.describe(it) })
    }

    @Test
    fun typingAndCantConnectAreRowsYouCanOpen() {
        val screen = settings()
        for (name in listOf("settings_typing_title", "settings_cant_connect_title")) {
            val row = screen.button(screen.string(name))
            assertNotNull("\"${screen.string(name)}\" is a row you can open; buttons: ${screen.buttons().map { screen.describe(it) }}", row)
            assertTrue("${screen.describe(row!!)} is at least 48 dp tall", screen.heightDp(row) >= 47.5f)
            assertTrue("${screen.describe(row)} spans the page", screen.widthDp(row) >= screen.screenWidthDp() * 0.6f)
        }
        val typing = screen.boundsDp(screen.button(screen.string("settings_typing_title"))!!)
        val inRow = screen.leaves.filter { screen.text(it).isNotBlank() && screen.boundsDp(it).let { b -> b.top >= typing.top - 1f && b.bottom <= typing.bottom + 1f } }
            .map { screen.text(it).trim() }
        assertEquals(
            "the Typing row says its title and only \"${screen.string("terminal_text_size")}\" (the one typing setting the phone has)",
            listOf(screen.string("settings_typing_title"), screen.string("terminal_text_size")),
            inRow,
        )
        val moved = listOf("terminal_size_small", "terminal_size_medium", "terminal_size_large", "home_enter_address").map { screen.string(it) }
            .filter { screen.leavesWithText(it).isNotEmpty() }
        assertEquals("the text size choice and the computer's address moved behind their rows", emptyList<String>(), moved)
    }
}

/**
 * A13's proof at the largest system font scale (RT-1: default and largest): nothing on Settings is cut. Its name keeps
 * "SettingsSectionsTest" so the criterion's --tests selects it. Frozen with SettingsSectionsTest.
 */
class SettingsSectionsTestAtTheLargestFont {
    @get:Rule
    val paparazzi = f4Paparazzi(fontScale = 2f)

    private val page = SettingsPage(paparazzi)

    @Test
    fun nothingOnSettingsIsCutAtTheLargestFont() {
        for (theme in ThemeChoice.entries) {
            page.preferences.theme = theme
            val screen = page.render {}
            assertEquals("no text is cut on Settings at the largest font (theme $theme)", emptyList<String>(), screen.cutTexts())
        }
    }
}

/**
 * Guards of A13, green on main (not in the criterion's proof): what Settings keeps while it moves to seven sections.
 * Frozen with SettingsSectionsTest; the executor must not edit them.
 */
class SettingsSectionsGuardTest {
    @get:Rule
    val paparazzi = f4Paparazzi()

    private val page = SettingsPage(paparazzi)
    private val preferences = page.preferences

    private fun settings(act: (Screen) -> Unit = {}): Screen = page.render(act)

    @Test
    fun nothingOnSettingsIsCut() {
        for (theme in ThemeChoice.entries) {
            preferences.theme = theme
            val screen = settings()
            assertEquals("no text is cut on Settings (theme $theme)", emptyList<String>(), screen.cutTexts())
            assertEquals("no text under 11 sp (BRD-07)", emptyList<Pair<String, Float>>(), screen.textSizes().filter { it.second < 11f })
        }
    }

    @Test
    fun notificationsKeepOneSwitchPerKind() {
        var tapped = false
        val screen = settings { s ->
            if (!tapped) {
                val title = s.titled("settings_alerts_title")
                val first = title?.let { t -> s.merged.filter { s.role(it) == Role.Switch && s.boundsDp(it).top > s.boundsDp(t).top }.minByOrNull { s.boundsDp(it).top } }
                if (first != null) {
                    tapped = true
                    s.tap(first)
                }
            }
        }
        val title = screen.titled("settings_alerts_title")
        assertNotNull("the Notifications card", title)
        val switches = screen.merged.filter { screen.role(it) == Role.Switch && screen.boundsDp(it).top > screen.boundsDp(title!!).top }
            .sortedBy { screen.boundsDp(it).top }.take(AlertKind.entries.size)
        assertEquals("one switch per kind of notification", AlertKind.entries.size, switches.size)
        for (switch in switches) assertTrue("${screen.describe(switch)} is at least 48 dp tall", screen.heightDp(switch) >= 47.5f)
        assertTrue("a tap on the first switch turns its kind off", !preferences.alertsEnabled(AlertKind.entries.first()))
    }

    @Test
    fun appearanceKeepsTheThreeThemes() {
        preferences.theme = ThemeChoice.DARK
        val screen = settings()
        val title = screen.titled("settings_theme_title")
        assertNotNull("the Appearance card", title)
        val below = screen.merged.filter { screen.role(it) == Role.Tab && screen.boundsDp(it).top > screen.boundsDp(title!!).top }
        val row = below.minOfOrNull { screen.boundsDp(it).top }
        val options = below.filter { kotlin.math.abs(screen.boundsDp(it).top - (row ?: 0f)) < 1f }.sortedBy { screen.boundsDp(it).left }
        assertEquals(
            "System, Light, Dark",
            listOf("settings_theme_system", "settings_theme_light", "settings_theme_dark").map { screen.string(it) },
            options.map { screen.label(it).trim() },
        )
        assertEquals("the chosen theme is the selected one", screen.string("settings_theme_dark"), options.firstOrNull { screen.selected(it) }?.let { screen.label(it).trim() })
    }

    @Test
    fun theComputerCardKeepsTheWaysOut() {
        val screen = settings()
        assertTrue("how it is connected", screen.leavesWithText("Conectado · mesma Wi-Fi").isNotEmpty())
        val unpair = screen.button(screen.string("settings_computer_unpair"))
        assertNotNull("Unpair this phone", unpair)
        assertTrue("${screen.describe(unpair!!)} is at least 48 dp tall", screen.heightDp(unpair) >= 47.5f)
    }
}

private val SECTION_NAMES = listOf("settings_answers_title", "settings_alerts_title", "settings_theme_title", "settings_typing_title", "settings_cant_connect_title", "settings_about_title")

/** Settings with a paired computer, on preferences kept in memory. */
private class SettingsPage(private val paparazzi: Paparazzi) {
    private val store = object : PreferenceStore {
        val values = mutableMapOf<String, String>()
        override fun getString(key: String) = values[key]
        override fun putString(key: String, value: String) {
            values[key] = value
        }
    }
    val preferences = PhonePreferences(store)

    fun render(act: (Screen) -> Unit): Screen = paparazzi.render(act = act) {
        SettingsScreen(preferences, computer = "Studio", connection = "Conectado · mesma Wi-Fi", version = "1.5.2", onEnterAddress = {}, onUnpair = {}) {}
    }
}

/** The topmost text leaf that says the string [name]. */
private fun Screen.titled(name: String): Shown? = string(name).let { wanted -> leavesWithText(wanted).minByOrNull { boundsDp(it).top } }
