package com.oxespace.mobile.notify

import android.content.Context
import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.ui.phonePaparazzi
import com.oxespace.mobile.ui.stringId
import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.2 P0 (Jira OXE-380; A6). Written by the planner; the executor must not edit it.
 *
 * A notification is trusted system UI: the agent's request.title is never in it, in any field.
 * Contract:
 * - AlertChange.Post carries what the words need (the request's kind and risk, new properties with defaults) and never
 *   request.title; for NEEDS_YOU its `text` is displaySafe(threadTitle, 80);
 * - notify/Notifications.kt has the top-level `fun needsYouAlertTexts(context: Context, post: AlertChange.Post):
 *   List<String>` = [title, text], from the app's catalog (kind, risk) and post.text, and apply() shows exactly that.
 */
class P0NotificationTextTest {
    @get:Rule
    val paparazzi = phonePaparazzi()

    private fun post(risk: String? = "high"): AlertChange.Post {
        val request = RemotePendingRequest(
            threadId = "t-1", workspaceId = "w", threadTitle = "Fix login" + "x".repeat(300), requestId = "r-1", generation = 1,
            kind = "approval", title = "SAFE UPDATE: open and approve", command = "rm -rf build", risk = risk,
            decisions = listOf("accept", "decline"), answerable = true, createdAt = 1,
        )
        return AlertWatcher().onRequests(listOf(request)).single() as AlertChange.Post
    }

    @Test
    fun noFieldOfTheNotificationCarriesTheAgentsTitle() {
        for (risk in listOf("high", "critical", null)) {
            val change = post(risk)
            assertFalse("the agent's title in $change", change.toString().contains("SAFE UPDATE"))
            assertTrue("the conversation, at most 80: ${change.text}", change.text.startsWith("Fix login") && change.text.codePointCount(0, change.text.length) <= 80)
        }
    }

    @Test
    fun theNotificationSaysTheAppsKindAndRiskAndTheConversation() {
        val method = try {
            Class.forName("com.oxespace.mobile.notify.NotificationsKt")
                .getDeclaredMethod("needsYouAlertTexts", Context::class.java, AlertChange.Post::class.java)
        } catch (error: ReflectiveOperationException) {
            fail("Notifications.kt has no needsYouAlertTexts(context, post): the notification still shows request.title")
            throw error
        }
        val shown = (method.invoke(null, paparazzi.context, post()) as List<*>).joinToString("\n")
        fun word(name: String) = paparazzi.context.resources.getString(stringId(name))
        assertFalse("the agent's title: $shown", shown.contains("SAFE UPDATE"))
        assertTrue("the catalog's kind: $shown", shown.contains(word("request_kind_agent")))
        assertTrue("the risk: $shown", shown.contains(word("request_risk_high")))
        assertTrue("the conversation: $shown", shown.contains("Fix login"))
    }

    @Test
    fun theSystemNotificationIsBuiltFromThoseWords() {
        // rigor: source-assertion. NotificationManager cannot be read on the JVM.
        val code = File("src/main/java/com/oxespace/mobile/notify/Notifications.kt").readText()
        assertTrue("apply() uses needsYouAlertTexts", Regex("""needsYouAlertTexts\(\s*context\s*,\s*change\s*\)""").containsMatchIn(code))
    }
}
