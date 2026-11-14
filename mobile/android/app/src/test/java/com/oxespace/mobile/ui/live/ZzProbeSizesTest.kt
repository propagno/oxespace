package com.oxespace.mobile.ui.live

import com.oxespace.mobile.protocol.live.LiveStreams
import com.oxespace.mobile.ui.F3Live
import com.oxespace.mobile.ui.RenderedScreen
import com.oxespace.mobile.ui.Samples
import com.oxespace.mobile.ui.phonePaparazzi
import com.oxespace.mobile.ui.render
import org.junit.Rule
import org.junit.Test

/** Planner probe, never committed: prints the texts under 12 sp per screen. */
class ZzProbeSizesTest {
    @get:Rule
    val paparazzi = phonePaparazzi()

    private fun dump(name: String, screen: RenderedScreen) {
        println("PROBE $name small=" + screen.textSizes().filter { it.second < 12f })
        println("PROBE $name buttons=" + screen.buttons().map { screen.describe(it) })
    }

    @Test
    fun probe() {
        for (tab in listOf(LiveTab.THREADS, LiveTab.REQUESTS)) {
            dump("home-$tab", paparazzi.render { LiveHome("Studio", null, F3Live.live(F3Live.APPROVAL, F3Live.QUESTION), {}, {}, {}, {}, {}, initialTab = tab) })
        }
        dump("thread", paparazzi.render {
            val w = F3Live.conversation(true, 1,
                """{"type":"message","id":"m1","role":"user","text":"x"}""",
                """{"type":"tool","id":"x1","name":"Bash","state":"completed","detail":"npm test -- auth","output":"ok","exitCode":0}""",
                """{"type":"message","id":"m2","role":"assistant","text":"y"}""",
                """{"type":"request","id":"q-1","requestId":"r-1","kind":"approval","title":"Delete","state":"pending"}""")
            ThreadScreen("t-1", w, LiveStreams().commands, Samples.presence, connected = true, pending = listOf(Samples.request())) {}
        })
        dump("terminal", paparazzi.render { TerminalScreen(Samples.pane, Samples.terminal(), LiveStreams().commands, Samples.presence) {} })
    }
}
