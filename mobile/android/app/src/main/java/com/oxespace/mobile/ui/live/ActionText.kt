package com.oxespace.mobile.ui.live

import com.oxespace.mobile.R
import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.live.CommandResult

/** What to tell the person after a command, or null when it went through. */
fun commandMessage(result: CommandResult): Int? = when (result) {
    is CommandResult.Done -> null
    CommandResult.Offline -> R.string.action_offline
    CommandResult.NoAnswer -> R.string.action_no_answer
    is CommandResult.Refused -> when (result.code) {
        RemoteErrorCode.RATE_LIMITED -> R.string.action_rate_limited
        RemoteErrorCode.PANE_NOT_SHARED, RemoteErrorCode.FORBIDDEN -> R.string.terminal_input_not_shared
        else -> R.string.action_refused
    }
}

/** The same for an answer to a request, whose refusals have their own words. */
fun answerMessage(result: CommandResult): Int = when (result) {
    is CommandResult.Done -> R.string.request_answered
    CommandResult.Offline -> R.string.action_offline
    CommandResult.NoAnswer -> R.string.action_no_answer
    is CommandResult.Refused -> when (result.code) {
        RemoteErrorCode.NOT_PENDING -> R.string.request_refused_not_pending
        RemoteErrorCode.STALE_GENERATION -> R.string.request_refused_stale_generation
        RemoteErrorCode.FORBIDDEN -> R.string.request_refused_forbidden
        RemoteErrorCode.RATE_LIMITED -> R.string.request_refused_rate_limited
        else -> R.string.request_refused_other
    }
}
