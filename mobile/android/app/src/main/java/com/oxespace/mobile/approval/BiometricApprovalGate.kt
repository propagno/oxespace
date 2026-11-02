package com.oxespace.mobile.approval

import android.content.Context
import com.oxespace.mobile.R
import com.oxespace.mobile.protocol.RemotePendingRequest

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
        return systemPrompt(context, title, request.threadTitle, request.title)
    }
}
