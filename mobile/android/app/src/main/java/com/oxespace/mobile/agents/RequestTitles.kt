package com.oxespace.mobile.agents

import com.oxespace.mobile.R

/**
 * The request titles main builds, by the C3 code the `agents` rows carry (`request.titleCode`, #354). The words come
 * from main.json through the generator (one catalog). A code this app doesn't know returns null, and the row shows the
 * `title` the desktop sent instead.
 */
internal fun requestTitleRes(code: String): Int? = when (code) {
    "agents.request.approval" -> R.string.desktop_title_agents_request_approval
    "agents.request.question" -> R.string.desktop_title_agents_request_question
    "agents.request.permissions" -> R.string.desktop_title_agents_request_permissions
    "agents.request.elicitation" -> R.string.desktop_title_agents_request_elicitation
    "agents.request.tool" -> R.string.desktop_title_agents_request_tool
    "approvals.title.agent" -> R.string.desktop_title_approvals_title_agent
    "approvals.title.oxequery" -> R.string.desktop_title_approvals_title_oxequery
    "approvals.title.previewAutomation" -> R.string.desktop_title_approvals_title_preview_automation
    "approvals.title.crash" -> R.string.desktop_title_approvals_title_crash
    else -> null
}
