package com.oxespace.mobile.approval

import android.content.Context
import com.oxespace.mobile.R
import com.oxespace.mobile.protocol.RemoteApprovalRisk
import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.displaySafe
import com.oxespace.mobile.ui.live.desktopImpactAction
import com.oxespace.mobile.ui.live.requestTitleString
import com.oxespace.mobile.ui.live.riskLevel

private const val PROMPT_THREAD_MAX = 80

/**
 * OXE-380 (A5): what the system's biometric prompt says besides its title, as [subtitle, description]. The prompt is
 * trusted UI, so the agent's own text never reaches it: the subtitle is the app's catalog label for the request's kind
 * (or, for a critical request, the desktop-calculated impact action) and the risk; the description is the
 * conversation's title made safe and cut at 80 characters.
 */
fun approvalPromptText(context: Context, request: RemotePendingRequest): List<String> {
    val level = request.risk?.let(::riskLevel)
    val kind = (if (level == RemoteApprovalRisk.CRITICAL) desktopImpactAction(request) else null)
        ?: context.getString(requestTitleString(request.kind))
    val subtitle = level?.let {
        val word = context.getString(
            when (it) {
                RemoteApprovalRisk.LOW -> R.string.request_risk_low
                RemoteApprovalRisk.MEDIUM -> R.string.request_risk_medium
                RemoteApprovalRisk.HIGH -> R.string.request_risk_high
                RemoteApprovalRisk.CRITICAL -> R.string.request_risk_critical
            },
        )
        "$kind · ${context.getString(R.string.request_risk_badge, word)}"
    } ?: kind
    return listOf(subtitle, displaySafe(request.threadTitle, PROMPT_THREAD_MAX))
}

/** Every answer to a request asks again: no window, unlike sending (see [KeystorePresence]). */
class BiometricApprovalGate(private val context: Context) : ApprovalGate {
    override suspend fun confirm(request: RemotePendingRequest, decision: String?): Boolean {
        val title = context.getString(
            when (decision) {
                "accept" -> R.string.approval_prompt_accept
                "decline" -> R.string.approval_prompt_decline
                "cancel" -> R.string.approval_prompt_cancel
                else -> R.string.approval_prompt_answer
            },
        )
        val (subtitle, description) = approvalPromptText(context, request)
        return systemPrompt(context, title, subtitle, description)
    }
}
