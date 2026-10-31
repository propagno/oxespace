package com.oxespace.mobile.ui.live

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import com.oxespace.mobile.R
import com.oxespace.mobile.ui.theme.Oxe

/** Words the desktop sends as data, in the phone's language; a value a newer desktop adds shows as it came. */
@Composable
fun threadStatusLabel(status: String): String = when (status) {
    "idle" -> stringResource(R.string.live_status_idle)
    "running" -> stringResource(R.string.live_status_running)
    "approval" -> stringResource(R.string.live_status_approval)
    "interrupted" -> stringResource(R.string.live_status_interrupted)
    "failed" -> stringResource(R.string.live_status_failed)
    else -> status
}

@Composable
fun threadStatusColor(status: String): Color = when (status) {
    "running" -> Oxe.colors.intentInfoFg
    "approval" -> Oxe.colors.intentWarningFg
    "failed" -> Oxe.colors.intentDangerFg
    else -> Oxe.colors.textSecondary
}

@Composable
fun jobStatusLabel(status: String): String = when (status) {
    "pending" -> stringResource(R.string.live_job_pending)
    "running" -> stringResource(R.string.live_job_running)
    "exited" -> stringResource(R.string.live_job_exited)
    "failed" -> stringResource(R.string.live_job_failed)
    "killed" -> stringResource(R.string.live_job_killed)
    else -> status
}

@Composable
fun agentStateLabel(state: String): String = when (state) {
    "working" -> stringResource(R.string.live_agent_state_working)
    "blocked" -> stringResource(R.string.live_agent_state_blocked)
    "done" -> stringResource(R.string.live_agent_state_done)
    "idle" -> stringResource(R.string.live_agent_state_idle)
    else -> stringResource(R.string.live_agent_state_unknown)
}

@Composable
fun toolStateLabel(state: String): String = when (state) {
    "running" -> stringResource(R.string.thread_tool_running)
    "completed" -> stringResource(R.string.thread_tool_completed)
    "failed" -> stringResource(R.string.thread_tool_failed)
    else -> stringResource(R.string.thread_tool_unknown)
}

@Composable
fun requestStateLabel(state: String): String = when (state) {
    "pending" -> stringResource(R.string.thread_request_state_pending)
    "resolved" -> stringResource(R.string.thread_request_state_resolved)
    "cancelled" -> stringResource(R.string.thread_request_state_cancelled)
    "expired" -> stringResource(R.string.thread_request_state_expired)
    else -> state
}

@Composable
fun completedLabel(status: String): String = when (status) {
    "interrupted" -> stringResource(R.string.thread_completed_interrupted)
    "failed" -> stringResource(R.string.thread_completed_failed)
    else -> stringResource(R.string.thread_completed_completed)
}

/** The risk color the desktop's prompt uses for a command. */
@Composable
fun riskColor(risk: String?): Color = when (risk) {
    "red" -> Oxe.colors.intentDangerFg
    "orange" -> Oxe.colors.intentWarningFg
    "green" -> Oxe.colors.intentSuccessFg
    else -> Oxe.colors.textSecondary
}
