package com.oxespace.mobile.ui

import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
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
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.live.ThreadTimeline
import com.oxespace.mobile.session.LiveRepository
import com.oxespace.mobile.session.Watched
import com.oxespace.mobile.ui.live.LocalClock
import com.oxespace.mobile.ui.theme.OxeTheme
import java.awt.image.BufferedImage
import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Assert.fail

/*
 * Frozen test support for 1.5.2 Celular F3 (OXE program oxespace-152-mobile, phase F3: A7-A12). Written by the planner;
 * the executor must not edit it.
 *
 * A screen rendered by Paparazzi on the JVM and read the way TalkBack and the layout see it: the semantics tree of the
 * real composables (unmerged leaves and merged nodes), with sizes in dp, the text layout of each Text (its size in sp,
 * weight, family and spans), the actions a node offers, and the strings of the active locale. Nothing is matched by an
 * English literal: labels come from the app's resources in the locale the screen renders, and a resource the task adds
 * is read by name ([string]) so this file compiles on main before the task exists.
 * Gradle runs unit tests from the module directory (`mobile/android/app`).
 */

/**
 * A phone in Brazilian Portuguese (the user's). These tests read the semantics, not the pixels: the frames are dropped,
 * so they never ask for goldens (verifyPaparazziDebug compares only the snapshot tests' images).
 */
fun phonePaparazzi(locale: String = "pt-rBR") = Paparazzi(
    deviceConfig = DeviceConfig.PIXEL_6.copy(locale = locale),
    theme = "android:Theme.Material.NoActionBar",
    snapshotHandler = DropFrames,
)

private object DropFrames : SnapshotHandler {
    override fun newFrameHandler(snapshot: Snapshot, frameCount: Int, fps: Int): SnapshotHandler.FrameHandler = object : SnapshotHandler.FrameHandler {
        override fun handle(image: BufferedImage) = Unit
        override fun close() = Unit
    }

    override fun close() = Unit
}

/** Three minutes after the fixtures' requests were made, as Samples.clock. */
val F3_CLOCK: () -> Long = { 1 + 3 * 60_000L }

/**
 * One semantics node, read while the screen is laid out: its configuration (merged when it is a merged node: the text
 * and labels of the children it merges), its bounds and size in px, and the style its text was laid out with. Read
 * later, a SemanticsNode would recompute the merge against a composition that is gone.
 */
class Node(val id: Int, val config: SemanticsConfiguration, val boundsPx: Rect, val widthPx: Int, val heightPx: Int, val isRoot: Boolean, val textStyle: TextStyle?)

private fun capture(node: SemanticsNode): Node {
    val config = node.config
    val results = mutableListOf<TextLayoutResult>()
    config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(results)
    return Node(node.id, config, node.boundsInRoot, node.size.width, node.size.height, node.isRoot, results.firstOrNull()?.layoutInput?.style)
}

class RenderedScreen(
    /** Every node on its own: text leaves, buttons, scroll containers. */
    val leaves: List<Node>,
    /** The nodes TalkBack stops on: a merging node carries its children's text and labels. */
    val merged: List<Node>,
    private val density: Float,
    val context: Context,
) {
    fun dp(px: Float): Float = px / density
    fun widthDp(node: Node): Float = dp(node.widthPx.toFloat())
    fun heightDp(node: Node): Float = dp(node.heightPx.toFloat())
    fun boundsDp(node: Node): Rect = node.boundsPx.let { Rect(dp(it.left), dp(it.top), dp(it.right), dp(it.bottom)) }

    /** The node's text (Text, EditableText) joined, without its content description. */
    fun text(node: Node): String =
        (node.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text } + listOfNotNull(node.config.getOrNull(SemanticsProperties.EditableText)?.text))
            .joinToString(" ")

    /** What TalkBack reads for the node: its content description, else its text. */
    fun label(node: Node): String =
        node.config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString(" ")?.takeIf { it.isNotBlank() } ?: text(node)

    fun role(node: Node): Role? = node.config.getOrNull(SemanticsProperties.Role)
    fun enabled(node: Node): Boolean = !node.config.contains(SemanticsProperties.Disabled)
    fun stateDescription(node: Node): String? = node.config.getOrNull(SemanticsProperties.StateDescription)
    fun selected(node: Node): Boolean = node.config.getOrNull(SemanticsProperties.Selected) == true
    fun isHeading(node: Node): Boolean = node.config.contains(SemanticsProperties.Heading)
    fun clickable(node: Node): Boolean = node.config.getOrNull(SemanticsActions.OnClick) != null
    fun scrollsSideways(node: Node): Boolean = node.config.getOrNull(SemanticsProperties.HorizontalScrollAxisRange) != null

    /**
     * Taps the node as TalkBack's double tap would, if it has a click action. Only inside [render]'s `act`, while the screen
     * is attached: the callbacks the screen was given run; the screen is not redrawn for the test.
     */
    fun tap(node: Node?) {
        node?.config?.getOrNull(SemanticsActions.OnClick)?.action?.invoke()
    }

    /** The style a Text node was laid out with: its size (sp), weight and family. */
    fun style(node: Node): TextStyle? = node.textStyle

    /** Buttons (merged), with the label TalkBack reads. */
    fun buttons(): List<Node> = merged.filter { role(it) == Role.Button || (clickable(it) && role(it) == null && label(it).isNotBlank()) }

    /** Text leaves whose own text is exactly [text]. */
    fun leavesWithText(text: String): List<Node> = leaves.filter { text(it).trim() == text }

    /** Text leaves whose own text contains [part]. */
    fun leavesContaining(part: String): List<Node> = leaves.filter { text(it).contains(part) }

    fun describe(node: Node): String = "\"${label(node)}\" (role ${role(node)}, ${"%.0f".format(widthDp(node))}x${"%.0f".format(heightDp(node))} dp)"

    /** A string of the active locale by resource name; fails, naming it, when the catalog does not have it. */
    fun string(name: String, vararg args: Any): String = context.resources.getString(stringId(name), *args)

    /** Every Text leaf drawn on the screen, with its size in sp. */
    fun textSizes(): List<Pair<String, Float>> = leaves.mapNotNull { node -> node.textStyle?.let { text(node) to it.fontSize.value } }
}

/** The id of `R.string.<name>`, read by name so a test compiles before the task adds the string. */
fun stringId(name: String): Int = try {
    Class.forName("com.oxespace.mobile.R\$string").getField(name).getInt(null)
} catch (_: NoSuchFieldException) {
    fail("the string resource R.string.$name does not exist (values/strings.xml and values-pt-rBR/strings.xml)"); 0
}

/**
 * Renders [content] in OxeTheme on the fixtures' clock and returns what the screen exposes after layout. [act] runs on
 * each layout pass while the screen is attached (taps must happen there); it may run more than once, so a test compares
 * the callbacks it recorded as a set, and it never asserts (an error inside it is rethrown after the render).
 */
fun Paparazzi.render(night: Boolean = false, act: (RenderedScreen) -> Unit = {}, content: @Composable () -> Unit): RenderedScreen {
    var rendered: RenderedScreen? = null
    var failure: Throwable? = null
    snapshot {
        val view = LocalView.current
        val density = LocalDensity.current.density
        val context = LocalContext.current
        Box(
            Modifier.onGloballyPositioned {
                val owner = (view as RootForTest).semanticsOwner
                val screen = RenderedScreen(
                    owner.getAllSemanticsNodes(mergingEnabled = false).map(::capture),
                    owner.getAllSemanticsNodes(mergingEnabled = true).map(::capture),
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
            OxeTheme(darkTheme = night) { CompositionLocalProvider(LocalClock provides F3_CLOCK) { content() } }
        }
    }
    failure?.let { throw it }
    return rendered ?: error("the screen was not laid out")
}

/** Live data for the home and its "Precisa de você" queue, through the same stores the app uses. */
object F3Live {
    private fun json(text: String) = RemoteFrames.json.parseToJsonElement(text)

    const val APPROVAL = """{"threadId":"t-1","workspaceId":"w-1","threadTitle":"Fix the login redirect","requestId":"r-1","generation":3,"kind":"approval",
        "title":"Run the auth tests","command":"npm test -- auth","cwd":".","toolName":"Bash","risk":"medium",
        "decisions":["accept","decline"],"answerable":true,"createdAt":1}"""

    val CRITICAL = APPROVAL.replace("\"risk\":\"medium\"", "\"risk\":\"critical\"").replace("npm test -- auth", "rm -rf dist build")

    const val QUESTION = """{"threadId":"t-1","workspaceId":"w-1","threadTitle":"Fix the login redirect","requestId":"r-2","generation":3,"kind":"question",
        "title":"Which environment?","questions":[{"id":"q1","question":"Run the migration against which database?","options":[{"label":"Staging"},{"label":"Local"}],"required":true}],
        "decisions":[],"answerable":true,"createdAt":1}"""

    fun live(vararg requests: String) = LiveRepository().apply {
        workspaces.onSnapshot(listOf(json("""{"workspaces":[{"id":"w-1","name":"oxespace","active":true,"panes":[]}]}""")))
        threads.onSnapshot(listOf(json("""{"threads":[
            {"id":"t-1","workspaceId":"w-1","title":"Fix the login redirect","provider":"claude","status":"running","pendingRequests":${requests.size},"updatedAt":5},
            {"id":"t-2","workspaceId":"w-1","title":"Add tests for the gateway","provider":"codex","status":"idle","lastTurnStatus":"completed","pendingRequests":0,"updatedAt":4}]}""")))
        pendingRequests.onSnapshot(listOf(json("""{"requests":[${requests.joinToString(",")}]}""")))
        jobs.onSnapshot(listOf(json("""{"jobs":[]}""")))
        delegations.onSnapshot(listOf(json("""{"delegations":[]}""")))
    }

    /** A conversation from its C5 items (JSON objects, in order), idle or running. */
    fun conversation(running: Boolean, pending: Int, vararg items: String) = Watched(ThreadTimeline()).apply {
        val header = """{"id":"t-1","workspaceId":"w-1","title":"Fix the login redirect","provider":"claude","status":"${if (running) "running" else "idle"}","pendingRequests":$pending,"updatedAt":5,"model":"opus","queued":0,"canSteer":true}"""
        val list = items.mapIndexed { index, item -> """{"seq":${index + 1},"item":$item}""" }.joinToString(",")
        onSnapshot(listOf(json("""{"thread":$header,"hasMore":false,"items":[$list]}""")))
    }
}

/** BRD-07 (OXE-69) in the code of a file the phase touches: rigor source-assertion (comments stripped). */
object PhoneScale {
    private val main = File("src/main/java/com/oxespace/mobile/ui")

    fun code(path: String): String {
        val file = File(main, path)
        assertTrue("$path exists", file.isFile)
        return file.readText()
            .replace(Regex("""/\*[\s\S]*?\*/"""), "")
            .lines().joinToString("\n") { line -> line.replace(Regex("""(?<!:)//.*$"""), "") }
    }

    /** Text under 11 sp, autosize below 11 sp, a corner radius that is not an OxeRadius token, or a literal colour. */
    fun offenders(path: String): List<String> {
        val code = code(path)
        val out = mutableListOf<String>()
        Regex("""\b([0-9]|10)(\.[0-9]+)?\.sp\b""").findAll(code).forEach { out += "$path: ${it.value} (under 11 sp)" }
        Regex("""minFontSize\s*=\s*([0-9.]+)\.sp""").findAll(code).filter { it.groupValues[1].toFloat() < 11f }.forEach { out += "$path: ${it.value}" }
        Regex("""RoundedCornerShape\(([^()]*(\([^()]*\))?[^()]*)\)""").findAll(code)
            .filterNot { m -> m.groupValues[1].trim().let { it.isEmpty() || Regex("""^OxeRadius\.\w+$""").matches(it) } }
            .forEach { out += "$path: ${it.value} (radius not an OxeRadius token)" }
        Regex("""Color\(0x""").findAll(code).forEach { _ -> out += "$path: literal colour" }
        return out
    }
}
