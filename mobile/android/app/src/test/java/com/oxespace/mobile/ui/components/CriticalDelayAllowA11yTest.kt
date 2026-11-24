package com.oxespace.mobile.ui.components

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import com.oxespace.mobile.ui.phonePaparazzi
import com.oxespace.mobile.ui.render
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/*
 * OXE-383 (part A): Allow on a critical request is reachable by TalkBack and Switch Access, confirms the completed hold
 * with a haptic, and starts over for each request.
 * - Once enabled, it offers a long-click action (TalkBack's double-tap-and-hold) labelled with the hold hint; still no
 *   click action, so a tap never allows. While the desktop's wait runs, it offers neither.
 * - The completed hold, by finger or by the accessibility action, performs HapticFeedbackType.LongPress.
 * - Its wait and its hold are remembered per request ([requestKey]), so a second critical request in a row starts with an
 *   empty ring instead of inheriting the first one's.
 */
class CriticalDelayAllowA11yTest {
    @get:Rule
    val paparazzi = phonePaparazzi()

    private val source: String by lazy {
        File("src/main/java/com/oxespace/mobile/ui/components/CriticalDelayAllow.kt").readText()
    }

    @Test
    fun enabledOffersALongClickWithTheHoldHintAndStillNoClick() {
        var held = 0
        var longClick: Boolean? = null
        val screen = paparazzi.render(act = { screen ->
            val node = screen.buttons().single()
            longClick = node.config.getOrNull(SemanticsActions.OnLongClick)?.action?.invoke()
        }) {
            CriticalDelayAllow(
                label = "Permitir",
                countdown = { "em $it s" },
                holdMs = 2_000L,
                enabled = true,
                holdHint = "Toque e segure para permitir",
                onHeld = { held += 1 },
                requestKey = "req-1#1",
            )
        }
        val node = screen.buttons().single()
        val action = node.config.getOrNull(SemanticsActions.OnLongClick)
        assertNotNull("an enabled critical Allow offers a long-click action", action)
        assertEquals("the action reads the hold hint", "Toque e segure para permitir", action!!.label)
        assertFalse("a tap never allows a critical request: no click action", screen.clickable(node))
        assertEquals("the accessibility long-click allows once", true, longClick)
        assertEquals(1, held)
    }

    @Test
    fun whileTheWaitRunsThereIsNoLongClick() {
        val screen = paparazzi.render {
            CriticalDelayAllow(
                label = "Permitir",
                countdown = { "em $it s" },
                holdMs = 2_000L,
                enabled = false,
                holdHint = "Toque e segure para permitir",
                onHeld = {},
                requestKey = "req-1#1",
            )
        }
        val node = screen.buttons().single()
        assertFalse(screen.enabled(node))
        assertNull("no long-click while the desktop's wait runs", node.config.getOrNull(SemanticsActions.OnLongClick))
        assertFalse(screen.clickable(node))
    }

    @Test
    fun theCompletedHoldIsFeltAndEachRequestStartsOver() {
        assertTrue("a LongPress haptic on the completed hold", source.contains("HapticFeedbackType.LongPress"))
        assertTrue("read from LocalHapticFeedback", source.contains("LocalHapticFeedback.current"))
        assertTrue("the wait is remembered per request", Regex("""remember\(requestKey, holdMs\)""").containsMatchIn(source))
        assertTrue("the hold is remembered per request", Regex("""remember\(requestKey\)\s*\{\s*mutableLongStateOf""").containsMatchIn(source))
        assertTrue("the wait restarts per request", Regex("""LaunchedEffect\(requestKey, holdMs\)""").containsMatchIn(source))
        val screen = File("src/main/java/com/oxespace/mobile/ui/live/RequestScreen.kt").readText()
        assertTrue("the Request screen passes the request's key", Regex("""requestKey = "\$\{request\.requestId\}#\$\{request\.generation\}"""").containsMatchIn(screen))
    }
}
