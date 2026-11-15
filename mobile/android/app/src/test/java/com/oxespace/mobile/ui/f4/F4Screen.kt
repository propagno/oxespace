package com.oxespace.mobile.ui.f4

import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.node.RootForTest
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsConfiguration
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getAllSemanticsNodes
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import app.cash.paparazzi.Snapshot
import app.cash.paparazzi.SnapshotHandler
import com.oxespace.mobile.ui.theme.OxeTheme
import java.awt.image.BufferedImage
import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Assert.fail

/*
 * Frozen test support for 1.5.2 Celular F4 (OXE program oxespace-152-mobile, phase F4: A13-A15; Jira OXE-102, BRD-24
 * F2: MOB-3, MOB-7, MOB-1). Written by the planner; the executor must not edit it.
 *
 * The same reading as Celular F3's RenderedScreen (a screen rendered by Paparazzi on the JVM and read the way TalkBack
 * and the layout see it), in its own package so it compiles on main before F3 lands and next to F3's file after it.
 * One addition: whether a Text was cut (an ellipsis, or more lines than its maxLines), from its own text layout.
 * Nothing is matched by an English literal on screen: labels come from the app's resources in the locale the screen
 * renders, and a resource a task adds is read by name ([stringId]) so this file and the tests compile on main before
 * the task exists. A test file holds two classes: the criterion's red tests, and its guards (green on main), so that
 * Gradle's --tests selects the criterion's proof by class.
 * Gradle runs unit tests from the module directory (mobile/android/app).
 */

/**
 * A phone in Brazilian Portuguese (the user's), frames dropped: these tests read the semantics, never ask for goldens.
 * [fontScale] 2.0 is the largest system font scale (Android 14+), the other scale BRD-24's RT-1 names.
 */
fun f4Paparazzi(locale: String = "pt-rBR", fontScale: Float = 1f) = Paparazzi(
    deviceConfig = DeviceConfig.PIXEL_6.copy(locale = locale, fontScale = fontScale),
    theme = "android:Theme.Material.NoActionBar",
    snapshotHandler = NoFrames,
)

private object NoFrames : SnapshotHandler {
    override fun newFrameHandler(snapshot: Snapshot, frameCount: Int, fps: Int): SnapshotHandler.FrameHandler = object : SnapshotHandler.FrameHandler {
        override fun handle(image: BufferedImage) = Unit
        override fun close() = Unit
    }

    override fun close() = Unit
}

/**
 * One semantics node, read while the screen is laid out: its configuration (merged for a merged node), its bounds in
 * px, the style its text was laid out with, and whether that text was cut (an ellipsis or lines beyond maxLines).
 */
class Shown(val config: SemanticsConfiguration, val boundsPx: Rect, val widthPx: Int, val heightPx: Int, val textStyle: TextStyle?, val cut: Boolean)

private fun read(node: SemanticsNode): Shown {
    val config = node.config
    val results = mutableListOf<TextLayoutResult>()
    config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(results)
    val layout = results.firstOrNull()
    // The semantics layout is built at the full width the Text was offered, so its size never "overflows" the paragraph:
    // an ellipsis or lines beyond maxLines are what a cut text shows.
    val cut = layout != null && (layout.multiParagraph.didExceedMaxLines || (0 until layout.lineCount).any { layout.isLineEllipsized(it) })
    return Shown(config, node.boundsInRoot, node.size.width, node.size.height, layout?.layoutInput?.style, cut)
}

class Screen(
    /** Every node on its own: text leaves, buttons, switches. */
    val leaves: List<Shown>,
    /** The nodes TalkBack stops on: a merging node carries its children's text and labels. */
    val merged: List<Shown>,
    private val density: Float,
    val context: Context,
) {
    fun widthDp(node: Shown): Float = node.widthPx / density
    fun heightDp(node: Shown): Float = node.heightPx / density
    fun boundsDp(node: Shown): Rect = node.boundsPx.let { Rect(it.left / density, it.top / density, it.right / density, it.bottom / density) }
    fun screenWidthDp(): Float = context.resources.displayMetrics.widthPixels / density

    /** The node's own text (Text, EditableText) joined, without its content description. */
    fun text(node: Shown): String =
        (node.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text } + listOfNotNull(node.config.getOrNull(SemanticsProperties.EditableText)?.text))
            .joinToString(" ")

    /** What TalkBack reads for the node: its content description, else its text. */
    fun label(node: Shown): String =
        node.config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString(" ")?.takeIf { it.isNotBlank() } ?: text(node)

    fun role(node: Shown): Role? = node.config.getOrNull(SemanticsProperties.Role)
    fun isHeading(node: Shown): Boolean = node.config.contains(SemanticsProperties.Heading)
    fun clickable(node: Shown): Boolean = node.config.getOrNull(SemanticsActions.OnClick) != null
    fun selected(node: Shown): Boolean = node.config.getOrNull(SemanticsProperties.Selected) == true
    fun toggles(node: Shown): Boolean = node.config.contains(SemanticsProperties.ToggleableState) || role(node) == Role.Switch || role(node) == Role.Checkbox

    /** Taps the node as TalkBack's double tap would. Only inside [render]'s `act`, while the screen is attached. */
    fun tap(node: Shown?) {
        node?.config?.getOrNull(SemanticsActions.OnClick)?.action?.invoke()
    }

    fun style(node: Shown): TextStyle? = node.textStyle

    /** Buttons (merged), with the label TalkBack reads. */
    fun buttons(): List<Shown> = merged.filter { role(it) == Role.Button || (clickable(it) && role(it) == null && label(it).isNotBlank()) }

    /** The merged button whose label is [label] or starts with it. */
    fun button(label: String): Shown? = buttons().firstOrNull { label(it).trim() == label } ?: buttons().firstOrNull { label(it).trim().startsWith(label) }

    /** Text leaves whose own text is exactly [text]. */
    fun leavesWithText(text: String): List<Shown> = leaves.filter { text(it).trim() == text }

    fun describe(node: Shown): String = "\"${label(node)}\" (role ${role(node)}, ${"%.0f".format(widthDp(node))}x${"%.0f".format(heightDp(node))} dp)"

    /** A string of the active locale by resource name; fails, naming it, when the catalog does not have it. */
    fun string(name: String, vararg args: Any): String = context.resources.getString(stringId(name), *args)

    /** Every Text leaf drawn on the screen, with its size in sp. */
    fun textSizes(): List<Pair<String, Float>> = leaves.mapNotNull { node -> node.textStyle?.let { text(node) to it.fontSize.value } }

    /** Every Text leaf whose layout was cut (an ellipsis or lines beyond maxLines), by its text. */
    fun cutTexts(): List<String> = leaves.filter { it.cut }.map { text(it) }
}

/** The id of `R.string.<name>`, read by name so a test compiles before the task adds the string. */
fun stringId(name: String): Int = try {
    Class.forName("com.oxespace.mobile.R\$string").getField(name).getInt(null)
} catch (_: NoSuchFieldException) {
    fail("the string resource R.string.$name does not exist (values/strings.xml and values-pt-rBR/strings.xml)"); 0
}

/** The raw value of `<string name="[name]">` in a catalog (`values` is en, `values-pt-rBR` is pt-BR), unescaped. */
fun catalog(dir: String, name: String): String? =
    Regex("""<string name="$name"(?: [^>]*)?>([^<]*)</string>""").find(File("src/main/res/$dir/strings.xml").readText())?.groupValues?.get(1)
        ?.replace("\\'", "'")?.replace("\\\"", "\"")

/** WCAG contrast ratio between two opaque colours. */
fun contrast(a: Color, b: Color): Float {
    val hi = maxOf(a.luminance(), b.luminance())
    val lo = minOf(a.luminance(), b.luminance())
    return (hi + 0.05f) / (lo + 0.05f)
}

/**
 * Renders [content] in OxeTheme and returns what the screen exposes after layout. [act] runs on each layout pass while
 * the screen is attached (taps must happen there); it may run more than once, so a test counts callbacks and compares
 * them as "at least once", and it never asserts (an error inside it is rethrown after the render). A tap does not
 * redraw the screen for the test: one frame is laid out.
 */
fun Paparazzi.render(night: Boolean = false, act: (Screen) -> Unit = {}, content: @Composable () -> Unit): Screen {
    var rendered: Screen? = null
    var failure: Throwable? = null
    snapshot {
        val view = LocalView.current
        val density = LocalDensity.current.density
        val context = LocalContext.current
        Box(
            Modifier.onGloballyPositioned {
                val owner = (view as RootForTest).semanticsOwner
                val screen = Screen(
                    owner.getAllSemanticsNodes(mergingEnabled = false).map(::read),
                    owner.getAllSemanticsNodes(mergingEnabled = true).map(::read),
                    density,
                    context,
                )
                rendered = screen
                try {
                    act(screen)
                } catch (error: Throwable) {
                    if (failure == null) failure = error
                }
            },
        ) {
            OxeTheme(darkTheme = night) { content() }
        }
    }
    failure?.let { throw it }
    return rendered ?: error("the screen was not laid out")
}

/** The code of a file under ui/ with comments stripped: rigor source-assertion, used only where marked. */
fun uiCode(path: String): String {
    val file = File("src/main/java/com/oxespace/mobile/ui", path)
    assertTrue("$path exists", file.isFile)
    return file.readText()
        .replace(Regex("""/\*[\s\S]*?\*/"""), "")
        .lines().joinToString("\n") { line -> line.replace(Regex("""(?<!:)//.*$"""), "") }
}
