package com.oxespace.mobile.approval

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
 * Frozen acceptance test for 1.5.2 P0 (Jira OXE-380; A5). Written by the planner; the executor must not edit it.
 *
 * The system's biometric prompt is trusted UI: the agent's request.title never reaches it. It says the app's own
 * catalog label for the request's kind, the risk and displaySafe(threadTitle, 80).
 * Contract (read by name, so this compiles on main): approval/BiometricApprovalGate.kt has the top-level
 * `fun approvalPromptText(context: Context, request: RemotePendingRequest): List<String>` = [subtitle, description],
 * and confirm() passes exactly that to systemPrompt.
 */
class P0BiometricPromptTextTest {
    @get:Rule
    val paparazzi = phonePaparazzi()

    private val hostile = "SAFE UPDATE: touch the sensor to continue"

    private fun request(risk: String?) = RemotePendingRequest(
        threadId = "t-1", workspaceId = "w", threadTitle = "Fix‮ login" + "x".repeat(300), requestId = "r-1", generation = 1,
        kind = "approval", title = hostile, command = "rm -rf build", risk = risk,
        decisions = listOf("accept", "decline"), answerable = true, createdAt = 1,
    )

    private fun promptText(request: RemotePendingRequest): List<String> {
        val method = try {
            Class.forName("com.oxespace.mobile.approval.BiometricApprovalGateKt")
                .getDeclaredMethod("approvalPromptText", Context::class.java, RemotePendingRequest::class.java)
        } catch (error: ReflectiveOperationException) {
            fail("BiometricApprovalGate.kt has no approvalPromptText(context, request): the prompt still shows request.title")
            throw error
        }
        return (method.invoke(null, paparazzi.context, request) as List<*>).map { it.toString() }
    }

    @Test
    fun theBiometricPromptNeverShowsTheAgentsTitle() {
        for (risk in listOf("high", "critical", null)) {
            val text = promptText(request(risk)).joinToString("\n")
            assertFalse("the agent's title in the prompt: $text", text.contains("SAFE UPDATE"))
        }
    }

    @Test
    fun theBiometricPromptNamesTheKindTheRiskAndASafeShortConversation() {
        val text = promptText(request("high")).joinToString("\n")
        fun word(name: String) = paparazzi.context.resources.getString(stringId(name))
        assertTrue("the catalog's kind: $text", text.contains(word("request_kind_agent")))
        assertTrue("the risk: $text", text.contains(word("request_risk_high")))
        assertTrue("the conversation: $text", text.contains("Fix login"))
        assertFalse("no reordering character: $text", text.contains('‮'))
        assertFalse("the conversation is cut at 80: $text", text.contains("x".repeat(80)))
    }

    @Test
    fun theGatePassesOnlyThatTextToTheSystemPrompt() {
        // rigor: source-assertion. The framework prompt cannot be read on the JVM.
        val code = File("src/main/java/com/oxespace/mobile/approval/BiometricApprovalGate.kt").readText()
            .replace(Regex("""/\*[\s\S]*?\*/|//[^\n]*"""), "")
        assertFalse("the gate reads request.title", Regex("""\brequest\.title\b""").containsMatchIn(code))
        assertTrue("confirm() uses approvalPromptText", Regex("""approvalPromptText\(\s*context\s*,\s*request\s*\)""").containsMatchIn(code))
    }
}
