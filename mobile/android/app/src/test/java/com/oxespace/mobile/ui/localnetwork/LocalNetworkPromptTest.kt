package com.oxespace.mobile.ui.localnetwork

import androidx.compose.ui.graphics.Color
import app.cash.paparazzi.Paparazzi
import com.oxespace.mobile.pairing.DeviceKeys
import com.oxespace.mobile.pairing.PairedDesktop
import com.oxespace.mobile.pairing.PairedDesktopStore
import com.oxespace.mobile.pairing.Pairer
import com.oxespace.mobile.pairing.PairingFlow
import com.oxespace.mobile.pairing.PairingProbe
import com.oxespace.mobile.pairing.PairingState
import com.oxespace.mobile.pairing.ProbeResult
import com.oxespace.mobile.protocol.RemotePairResponse
import com.oxespace.mobile.protocol.pairing.PairOutcome
import com.oxespace.mobile.ui.LocalNetworkAsk
import com.oxespace.mobile.ui.LocalNetworkPrompt
import com.oxespace.mobile.ui.f4.Screen
import com.oxespace.mobile.ui.f4.catalog
import com.oxespace.mobile.ui.f4.contrast
import com.oxespace.mobile.ui.f4.f4Paparazzi
import com.oxespace.mobile.ui.f4.render
import com.oxespace.mobile.ui.f4.uiCode
import com.oxespace.mobile.ui.pairing.PairingScreen
import com.oxespace.mobile.ui.theme.Oxe
import java.io.File
import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.2 Celular A15 (OXE program oxespace-152-mobile, phase F4, Jira OXE-102 / BRD-24 F2,
 * MOB-1: a readable local network screen, asked at step 2). Written by the planner; the executor must not edit it.
 *
 * The target is MARCA's approved phone playground in Mandacaru Noite (artefact JpDiD9nKrPrMXdcnkED4US, Celular; the
 * "Acesso à rede local" mock of oxespace-152-brand/.brand-audit/live/celular.html: "Vira um cartão legível com o porquê
 * e o botão na base, com margem"), with MARCA's answer of 15/11 (Q-M6, via the coordination):
 * - the ask moves to step 2 (Conectar), right before the phone first talks to the computer: a scanned code no longer
 *   waits behind the permission at the camera. PairingFlow takes a last constructor parameter
 *   `localNetworkGranted: () -> Boolean = { true }`; after a valid scan, when it says false, the flow holds the code
 *   and shows `PairingState.AskingLocalNetwork(desktopName: String?)` (no key is made, the computer is not contacted);
 *   `PairingFlow.onLocalNetworkGranted()` then goes on with the held code; when it says true, the scan goes straight
 *   on as today. PairingViewModel passes `{ LocalNetworkAccess.granted(application) }` and MainActivity calls
 *   onLocalNetworkGranted once Android grants it. Read here by name, so this file compiles on main;
 * - on screen, AskingLocalNetwork is step 2 ("2/4: Conectar") and PairingScreen shows its camera slot in the dark
 *   camera area, where MainActivity puts the prompt (LocalNetworkGate) instead of the camera;
 * - the prompt card is readable on that dark area (its own surface-raised card, text-primary): the title
 *   (local_network_title), why the app asks (local_network_needed), then the button (local_network_allow, an OxeButton
 *   at least 48 dp tall with at least 16 dp to each side of the screen) which asks Android (onAllow), and under it the
 *   new note local_network_next ("Android will show its own prompt next." / "O Android mostra o próprio aviso em
 *   seguida."); no other new copy;
 * - after a refusal: local_network_denied and "Abrir configurações do app" (onOpenSettings), and no note (Android stops
 *   asking);
 * - every text at least 4.5:1 on the app's surfaces in both themes (fixed on main by fb4b1fa2b, kept) and nothing under
 *   11 sp: the guards in LocalNetworkPromptGuardTest below, green on main.
 * The flow tests are LocalNetworkPromptTestAtStepTwo below (its name keeps "LocalNetworkPromptTest" so the criterion's
 * --tests selects it).
 *
 * Red at F4 @ origin/main 4fabc30f5: the phone asks before the scan (LocalNetworkGate around the camera), PairingFlow
 * has no local network check and no AskingLocalNetwork state, there is no note on Android's prompt, and the buttons are
 * Material's Button and OutlinedButton.
 */
class LocalNetworkPromptTest {
    @get:Rule
    val paparazzi = f4Paparazzi()

    private val host = PromptHost(paparazzi)

    private fun prompt(ask: LocalNetworkAsk, act: (Screen) -> Unit = {}): Screen = host.render(askingState(), ask, false, act)

    @Test
    fun theAskIsStepTwoInTheCameraArea() {
        val screen = prompt(LocalNetworkAsk.NOT_ASKED)
        val step = "2/4: ${screen.string("pairing_step_connect")}"
        assertTrue("the steps say \"$step\"; stops: ${screen.merged.map { screen.label(it) }.filter { it.contains("/4") }}", screen.merged.any { screen.label(it) == step })
        assertTrue("the prompt is shown where the camera was", screen.leavesWithText(screen.string("local_network_title")).isNotEmpty())
    }

    @Test
    fun thePromptSaysWhyThenAsksThenWhatComesNext() {
        host.allows = 0
        var tapped = false
        val screen = prompt(LocalNetworkAsk.NOT_ASKED) { s -> if (!tapped) s.button(s.string("local_network_allow"))?.let { tapped = true; s.tap(it) } }
        val title = screen.leavesWithText(screen.string("local_network_title")).firstOrNull()
        assertNotNull("the title", title)
        assertTrue("the title is a heading", screen.isHeading(title!!))
        val order = listOf("local_network_title", "local_network_needed").map { it to screen.top(it) }
        for ((name, top) in order) assertNotNull("\"${screen.string(name)}\" ($name) is on the screen", top)
        val allow = screen.button(screen.string("local_network_allow"))
        assertNotNull("the allow button; buttons: ${screen.buttons().map { screen.describe(it) }}", allow)
        val note = screen.top("local_network_next")
        assertNotNull("the note on Android's prompt", note)
        val tops = order.map { it.second!! } + screen.boundsDp(allow!!).top + note!!
        assertEquals("the title, why, the button, the note: top to bottom ($tops)", tops.sorted(), tops)
        val box = screen.boundsDp(allow)
        assertTrue("${screen.describe(allow)} is at least 48 dp tall", screen.heightDp(allow) >= 47.5f)
        assertTrue("the button keeps 16 dp from each side of the screen: $box", box.left >= 15.5f && box.right <= screen.screenWidthDp() - 15.5f)
        assertTrue("the button asks Android (onAllow)", host.allows > 0)

        val denied = prompt(LocalNetworkAsk.DENIED)
        assertTrue("after a refusal there is no note on Android's prompt (Android stops asking)", denied.top("local_network_next") == null)
        assertTrue("after a refusal the text names the permission", denied.top("local_network_denied") != null)
    }

    @Test
    fun theNoteIsTheOneNewString() {
        assertEquals("Android will show its own prompt next.", catalog("values", "local_network_next"))
        assertEquals("O Android mostra o próprio aviso em seguida.", catalog("values-pt-rBR", "local_network_next"))
        assertEquals("Abrir configurações do app", catalog("values-pt-rBR", "local_network_open_settings"))
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
 * A15's flow: the ask comes after the scan, before the phone talks to the computer. Its name keeps
 * "LocalNetworkPromptTest" so the criterion's --tests selects it. Frozen with LocalNetworkPromptTest.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LocalNetworkPromptTestAtStepTwo {
    private val uri = "oxespace://pair?v=1&host=192.168.0.12&port=7443&fp=${"b".repeat(64)}&code=AbCdEfGhIjKlMnOpQrSt_-&name=Studio"

    /** A flow whose computer accepts at once; [calls] records each time the phone talks to it, [keys] each key made. */
    private fun newFlow(scope: TestScope, granted: () -> Boolean, calls: MutableList<String>, keys: MutableList<String>): PairingFlow {
        val constructors = PairingFlow::class.java.constructors
        val full = constructors.firstOrNull { it.parameterCount == 10 && it.parameterTypes.last() == Function0::class.java }
        assertNotNull(
            "PairingFlow(…, probe, localNetworkGranted: () -> Boolean = { true }): its last constructor parameter; constructors: " +
                constructors.map { c -> c.parameterTypes.map { it.simpleName } },
            full,
        )
        val pairer = Pairer { _, _, _, onSent ->
            calls += "pair"
            onSent()
            PairOutcome.Paired(RemotePairResponse("dev-7", "tok", 900_000))
        }
        val keysFor: (String) -> DeviceKeys = { alias -> keys += alias; Keys() }
        val newAlias: () -> String = { "alias-${keys.size + 1}" }
        val onPaired: () -> Unit = {}
        val probe = PairingProbe { _, _ -> ProbeResult.Ok }
        return full!!.newInstance(scope, StandardTestDispatcher(scope.testScheduler), pairer, keysFor, Store(), "Pixel 8", newAlias, onPaired, probe, granted) as PairingFlow
    }

    @Test
    fun aScanAsksForTheLocalNetworkBeforeThePhoneTalksToTheComputer() = runTest {
        var allowed = false
        val calls = mutableListOf<String>()
        val keys = mutableListOf<String>()
        val flow = newFlow(this, { allowed }, calls, keys)
        flow.onScanned(uri)
        advanceUntilIdle()
        assertEquals("after the scan, without the permission: AskingLocalNetwork", "AskingLocalNetwork", flow.state.value::class.simpleName)
        assertEquals("the phone has not talked to the computer yet", emptyList<String>(), calls)
        assertEquals("no key is made before the ask", emptyList<String>(), keys)
        allowed = true
        PairingFlow::class.java.getMethod("onLocalNetworkGranted").invoke(flow)
        advanceUntilIdle()
        assertEquals("once granted, the held code goes on: the phone talks to the computer once", listOf("pair"), calls)
        assertTrue("and pairs: ${flow.state.value}", flow.state.value is PairingState.Paired)
    }

    @Test
    fun withTheLocalNetworkAlreadyAllowedTheScanGoesStraightOn() = runTest {
        val calls = mutableListOf<String>()
        val flow = newFlow(this, { true }, calls, mutableListOf())
        flow.onScanned(uri)
        advanceUntilIdle()
        assertEquals("no ask: the phone talks to the computer at once", listOf("pair"), calls)
        assertTrue("and pairs: ${flow.state.value}", flow.state.value is PairingState.Paired)
    }

    @Test
    fun theAppWiresTheAskToAndroidsPermission() {
        // rigor: source-assertion. The ViewModel and the Activity need an Android Context; this module has no Robolectric.
        fun code(path: String): String = File("src/main/java/com/oxespace/mobile", path).readText()
            .replace(Regex("""/\*[\s\S]*?\*/"""), "")
            .lines().joinToString("\n") { line -> line.replace(Regex("""(?<!:)//.*$"""), "") }
        assertTrue(
            "PairingViewModel gives the flow Android's answer (localNetworkGranted = { LocalNetworkAccess.granted(…) })",
            Regex("""localNetworkGranted\s*=\s*\{[^}]*LocalNetworkAccess\.granted\(""").containsMatchIn(code("pairing/PairingViewModel.kt")),
        )
        assertTrue("MainActivity tells the flow once Android grants it (onLocalNetworkGranted)", code("MainActivity.kt").contains("onLocalNetworkGranted"))
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

    @Test
    fun afterARefusalItNamesTheSettings() {
        host.settings = 0
        var tapped = false
        val screen = host.render(PairingState.Scanning, LocalNetworkAsk.DENIED, false) { s ->
            if (!tapped) s.button(s.string("local_network_open_settings"))?.let { tapped = true; s.tap(it) }
        }
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
                val screen = host.render(PairingState.Scanning, ask, night) {}
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

/** `PairingState.AskingLocalNetwork("Studio")`, read by name so this file compiles before the task adds it. */
private fun askingState(): PairingState = try {
    Class.forName("com.oxespace.mobile.pairing.PairingState\$AskingLocalNetwork").getConstructor(String::class.java).newInstance("Studio") as PairingState
} catch (missing: ReflectiveOperationException) {
    throw AssertionError("PairingState.AskingLocalNetwork(desktopName: String?) does not exist: $missing")
}

/** The prompt in the pairing screen's camera area, counting its two actions. */
private class PromptHost(private val paparazzi: Paparazzi) {
    var allows = 0
    var settings = 0

    /** The app's surfaces of the theme last rendered: the card's and the page's. */
    var surfaces = emptyList<Color>()

    fun render(state: PairingState, ask: LocalNetworkAsk, night: Boolean, act: (Screen) -> Unit): Screen = paparazzi.render(night, act) {
        surfaces = listOf(Oxe.colors.surfaceRaised, Oxe.colors.surfaceCanvas)
        PairingScreen(state, {}, {}) { modifier -> LocalNetworkPrompt(ask, { allows++ }, { settings++ }, modifier) }
    }
}

/** The top (dp) of the first text leaf that says the string [name], or null when none does. */
private fun Screen.top(name: String): Float? = leavesWithText(string(name)).minOfOrNull { boundsDp(it).top }

/** Software keys with the Keystore's shape, for the flow tests. */
private class Keys : DeviceKeys {
    private val pair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
    override fun publicKeySpki(): ByteArray = pair.public.encoded
    override fun sign(data: ByteArray): ByteArray = error("not used while pairing")
    override fun delete() = Unit
}

/** A store kept in memory, for the flow tests. */
private class Store : PairedDesktopStore {
    var saved: PairedDesktop? = null
    override fun load() = saved
    override fun save(desktop: PairedDesktop) {
        saved = desktop
    }

    override fun clear() {
        saved = null
    }
}
