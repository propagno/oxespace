package com.oxespace.mobile.ui.live

import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.node.RootForTest
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getAllSemanticsNodes
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.text.TextLayoutResult
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import app.cash.paparazzi.Snapshot
import app.cash.paparazzi.SnapshotHandler
import com.oxespace.mobile.R
import com.oxespace.mobile.ui.Samples
import com.oxespace.mobile.ui.theme.OxeTheme
import java.awt.image.BufferedImage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * OXE-69 (BRD-07), MARCA's fix for #833: the home's bottom bar never cuts a tab's label. With the 11 sp floor, five
 * labels may not fit at a large system font; then only the selected tab shows its label and the others are icons that
 * keep their name for TalkBack (and the Requests count). At the default font every tab shows its label. The decision
 * is measured, never by locale, so both languages are checked. The screen is read through its semantics on the JVM;
 * the frames are dropped, so this test has no goldens.
 */
@RunWith(Parameterized::class)
class LiveTabBarTest(private val fontScale: Float, private val locale: String) {
    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{1}-{0}")
        fun variants() = listOf(arrayOf<Any>(1f, "en"), arrayOf<Any>(1f, "pt-rBR"), arrayOf<Any>(2f, "en"), arrayOf<Any>(2f, "pt-rBR"))

        private val labels = mapOf(
            LiveTab.THREADS to R.string.live_tabs_threads,
            LiveTab.REQUESTS to R.string.live_tabs_requests,
            LiveTab.TERMINALS to R.string.live_tabs_terminals,
            LiveTab.TASKS to R.string.live_tabs_tasks,
            LiveTab.AGENTS to R.string.live_tabs_agents,
        )
    }

    @get:Rule
    val paparazzi = Paparazzi(
        deviceConfig = DeviceConfig.PIXEL_6.copy(fontScale = fontScale, locale = locale),
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

    /** A tab as TalkBack reads it, and the text drawn inside it with how it was laid out. */
    private class Tab(val selected: Boolean, val text: String, val description: String, val state: String?, val layouts: List<TextLayoutResult>, val innerRoles: List<Role>)

    private class Bar(val tabs: List<Tab>, val names: Map<LiveTab, String>, val waiting: String)

    private fun innerRoles(node: SemanticsNode): List<Role> =
        node.children.flatMap { child -> listOfNotNull(child.config.getOrNull(SemanticsProperties.Role)) + innerRoles(child) }

    private fun layouts(node: SemanticsNode): List<TextLayoutResult> {
        val own = mutableListOf<TextLayoutResult>()
        node.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(own)
        return own + node.children.flatMap { layouts(it) }
    }

    /** The bottom bar's tabs, read once the home is laid out with [selected] as the open tab. */
    private fun bar(selected: LiveTab): Bar {
        var read: Bar? = null
        paparazzi.snapshot {
            val view = LocalView.current
            val resources = LocalResources.current
            Box(
                Modifier.onGloballyPositioned {
                    val owner = (view as RootForTest).semanticsOwner
                    // The bottom bar's row only: a screen's own content may have tabs too (Agents).
                    val all = owner.getAllSemanticsNodes(mergingEnabled = true).filter { it.config.getOrNull(SemanticsProperties.Role) == Role.Tab }
                    val bottom = all.maxOfOrNull { it.boundsInRoot.top } ?: 0f
                    val tabs = all.filter { it.boundsInRoot.top >= bottom - 1f }
                        .sortedBy { it.boundsInRoot.left }
                        .map { node ->
                            val unmerged = owner.getAllSemanticsNodes(mergingEnabled = false).first { it.id == node.id }
                            Tab(
                                selected = node.config.getOrNull(SemanticsProperties.Selected) == true,
                                text = node.config.getOrNull(SemanticsProperties.Text).orEmpty().joinToString(" ") { it.text },
                                description = node.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty().joinToString(" "),
                                state = node.config.getOrNull(SemanticsProperties.StateDescription),
                                layouts = layouts(unmerged),
                                innerRoles = innerRoles(unmerged),
                            )
                        }
                    val names = labels.mapValues { resources.getString(it.value) }
                    read = Bar(tabs, names, resources.getQuantityString(R.plurals.live_requests_badge, 1, 1))
                },
            ) {
                OxeTheme { CompositionLocalProvider(LocalClock provides Samples.clock) { LiveHome("Studio", null, Samples.live(), {}, {}, {}, {}, {}, initialTab = selected) } }
            }
        }
        return read ?: error("the home was not laid out")
    }

    private fun Bar.name(index: Int) = names.getValue(LiveTab.entries[index])

    /** The tab's label as drawn (the Requests badge's count is a text of its own). */
    private fun Tab.labelLayouts(name: String) = layouts.filter { it.layoutInput.text.text == name }

    private fun describe(layout: TextLayoutResult) = with(layout) {
        "${layoutInput.style.fontSize}, box ${size.width}x${size.height} px, text ${multiParagraph.width}x${multiParagraph.height} px, " +
            "max ${layoutInput.constraints.maxWidth}x${layoutInput.constraints.maxHeight}, overflow w=$didOverflowWidth h=$didOverflowHeight"
    }

    @Test
    fun noTabLabelIsCut() {
        for (selected in LiveTab.entries) {
            val bar = bar(selected)
            assertEquals("five tabs", LiveTab.entries.size, bar.tabs.size)
            bar.tabs.forEachIndexed { i, tab ->
                for (layout in tab.labelLayouts(bar.name(i))) {
                    val where = "\"${bar.name(i)}\" (open: $selected, font x$fontScale, $locale; ${describe(layout)})"
                    val extent = if (layout.lineCount == 0) 0f else layout.getLineRight(0) - layout.getLineLeft(0)
                    assertTrue("$where is cut: it is wider than its tab", !layout.didOverflowWidth && extent <= layout.size.width + 1f)
                    assertTrue("$where is cut: it ends in an ellipsis", layout.lineCount == 0 || !layout.isLineEllipsized(0))
                    assertTrue("$where is drawn at ${layout.layoutInput.style.fontSize}, under 11 sp", layout.layoutInput.style.fontSize.value >= 11f)
                }
            }
        }
    }

    @Test
    fun theBarShowsEveryLabelAtTheDefaultFontAndOnlyTheOpenOneAtALargeFont() {
        for (selected in LiveTab.entries) {
            val bar = bar(selected)
            bar.tabs.forEachIndexed { i, tab ->
                val name = bar.name(i)
                val open = LiveTab.entries[i] == selected
                assertEquals("the open tab is $selected", open, tab.selected)
                if (fontScale <= 1f || open) {
                    assertEquals("\"$name\" shows its label (open: $selected, font x$fontScale, $locale)", name, tab.text)
                    assertTrue("\"$name\" draws its label", tab.labelLayouts(name).isNotEmpty())
                } else {
                    assertEquals("\"$name\" is an icon only at font x$fontScale (open: $selected, $locale)", "", tab.text)
                    assertTrue("\"$name\" draws no label at font x$fontScale (open: $selected, $locale)", tab.labelLayouts(name).isEmpty())
                    assertEquals("\"$name\" keeps its name for TalkBack", name, tab.description)
                    assertTrue("\"$name\" reads as a tab, not as an image inside it", Role.Image !in tab.innerRoles)
                }
                if (LiveTab.entries[i] == LiveTab.REQUESTS) assertEquals("Requests says how many wait", bar.waiting, tab.state)
            }
        }
    }
}
