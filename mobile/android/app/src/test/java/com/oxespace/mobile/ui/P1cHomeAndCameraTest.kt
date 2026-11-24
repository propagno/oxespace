package com.oxespace.mobile.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import com.oxespace.mobile.session.DesktopStatus
import com.oxespace.mobile.ui.theme.DarkOxeColors
import com.oxespace.mobile.ui.theme.LightOxeColors
import com.oxespace.mobile.ui.theme.OxeColors
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.2 152p1c (phase F1, Jira OXE-381). Written by the planner; the executor must not edit
 * it. Read the way TalkBack and the layout see it (RenderedScreen), in the user's pt-BR.
 *
 * - Before the camera is allowed, its explanation sits on the viewfinder's dark ground (termBg): its text reads at a
 *   contrast of at least 4.5:1 there, in light and in dark (today the light theme's dark text, about 1.1:1), and it
 *   keeps at least 16 dp from the viewfinder's edge (today 0 dp). Checked on its source: its own Oxe.colors token, on
 *   the real palettes, and its padding. That the scanner's corner guides no longer cross it
 *   is reviewed on the pairing goldens (record branch), not here.
 * - Settings (theme, text size, "Não consegue conectar?") open from Home before any desktop is reached: Home shows a
 *   Settings button while Unpaired and while Unreachable. HomeScreen takes `onSettings: () -> Unit = {}` (a default,
 *   so this file compiles on main) and MainActivity passes it.
 * (The stepper's step 2 during the local network ask is already frozen on main: LocalNetworkPromptTest, "2/4: Conectar".)
 * Gradle runs unit tests from the module directory (`mobile/android/app`).
 */
class P1cHomeAndCameraTest {
    @get:Rule
    val paparazzi = phonePaparazzi()

    private fun contrast(a: Color, b: Color): Float {
        val (light, dark) = listOf(a.luminance(), b.luminance()).sortedDescending()
        return (light + 0.05f) / (dark + 0.05f)
    }

    /** CameraWithPermission's body in PairingScreen.kt, up to the next top-level function. */
    private fun cameraGateSource(): String {
        val source = java.io.File("src/main/java/com/oxespace/mobile/ui/pairing/PairingScreen.kt").readText().replace("\r\n", "\n")
        val start = source.indexOf("fun CameraWithPermission(")
        assertTrue("CameraWithPermission is in PairingScreen.kt", start >= 0)
        val end = source.indexOf("\n}\n", start)
        return source.substring(start, if (end < 0) source.length else end)
    }

    /** A color token of a palette by name (OxeColors' getters are mangled for the Color value class). */
    private fun token(palette: OxeColors, name: String): Color {
        val getter = OxeColors::class.java.methods.firstOrNull { it.parameterCount == 0 && (it.name == "get" + name.replaceFirstChar(Char::uppercase) || it.name.startsWith("get" + name.replaceFirstChar(Char::uppercase) + "-")) }
        assertTrue("OxeColors has a color token named $name", getter != null)
        return Color((getter!!.invoke(palette) as Long).toULong())
    }

    // rigor: source-assertion — CameraWithPermission asks Android for the camera permission while it composes, which the
    // JVM renderer cannot answer; the criterion is the explanation's own color token and padding, measured on the real
    // light and dark palettes against the viewfinder's ground (termBg).
    private fun cameraGate(palette: OxeColors, theme: String) {
        val gate = cameraGateSource()
        // The explanation's Text call, however it is wrapped: from its "Text(" to the block's first button.
        val explanation = gate.substring(gate.indexOf("Text(").coerceAtLeast(0)).let { rest -> rest.substring(0, rest.indexOf("OxeButton(").let { end -> if (end < 0) minOf(rest.length, 500) else end }) }
        assertTrue("the explanation is the first Text of the not-allowed block: $explanation", explanation.contains("pairing_camera_needed"))
        val name = Regex("""color\s*=\s*Oxe\.colors\.(\w+)""").find(explanation)?.groupValues?.get(1)
        assertTrue("the explanation names its own color token (Oxe.colors.<token>) instead of the theme's text color: $explanation", name != null)
        val ratio = contrast(token(palette, name!!), palette.termBg)
        assertTrue("the explanation ($name) reads at 4.5:1 on termBg in $theme: ${"%.2f".format(ratio)}", ratio >= 4.5f)
        val notAllowed = gate.substring(gate.indexOf("if (granted)").coerceAtLeast(0))
        assertTrue("the not-allowed block keeps 16 dp from the viewfinder's edge (padding(OxeSpace.space4) or more)", Regex("""padding\((all\s*=\s*)?OxeSpace\.space([4-9]|1[0-9])\)""").containsMatchIn(notAllowed))
    }

    @Test
    fun theCameraExplanationReadsOnTheViewfinderInLight() = cameraGate(LightOxeColors, "light")

    @Test
    fun theCameraExplanationReadsOnTheViewfinderInDark() = cameraGate(DarkOxeColors, "dark")

    private fun settingsFromHome(status: DesktopStatus) {
        val screen = paparazzi.render { HomeScreen(status, {}, {}, { true }, {}) }
        val names = setOf(screen.string("settings_title"), screen.string("live_menu_settings"))
        val settings = screen.buttons().filter { screen.label(it) in names }
        assertTrue("Home ($status) has a Settings button; buttons: ${screen.buttons().map(screen::describe)}", settings.isNotEmpty())
    }

    @Test
    fun settingsOpenFromHomeWhileUnpaired() = settingsFromHome(DesktopStatus.Unpaired())

    @Test
    fun settingsOpenFromHomeWhileUnreachable() = settingsFromHome(DesktopStatus.Unreachable(Samples.desktop, 8_000))

    // rigor: source-assertion — MainActivity is an Activity; the criterion is that Home's Settings opens the screen.
    @Test
    fun mainActivityOpensSettingsFromHome() {
        val source = java.io.File("src/main/java/com/oxespace/mobile/MainActivity.kt").readText()
        val start = source.indexOf("else -> HomeScreen(")
        assertTrue("MainActivity shows HomeScreen when no desktop is live", start >= 0)
        // The HomeScreen call and its arguments (LiveHome's own onSettings comes much later in the file).
        val call = source.substring(start, minOf(source.length, start + 900))
        assertTrue("MainActivity's HomeScreen(...) passes onSettings = { settingsOpen = true }", Regex("""onSettings\s*=\s*\{\s*settingsOpen\s*=\s*true\s*\}""").containsMatchIn(call))
    }
}
