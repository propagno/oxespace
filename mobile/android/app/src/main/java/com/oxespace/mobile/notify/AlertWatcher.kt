package com.oxespace.mobile.notify

import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.RemoteThreadSummary

/** Where a notification's tap leads. */
sealed interface AlertTarget {
    data class Request(val threadId: String, val requestId: String) : AlertTarget
    data class Thread(val threadId: String) : AlertTarget
}

enum class AlertKind { NEEDS_YOU, DONE, FAILED }

sealed interface AlertChange {
    /** Show (or update) the notification with [key]. */
    data class Post(val key: String, val kind: AlertKind, val title: String, val text: String, val target: AlertTarget) : AlertChange
    /** The reason for it is gone (answered elsewhere): take it down. */
    data class Cancel(val key: String) : AlertChange
}

/**
 * Turns the live lists into notifications: a request waiting for the person ("needs you"), and a conversation whose
 * turn finished or failed. A request is announced once, however often the lists are resent (reconnections, a phone
 * waking from Doze), and taken down when it's answered anywhere. A conversation's first sighting is only a baseline.
 */
class AlertWatcher {
    private val announced = mutableSetOf<String>()
    private val lastStatus = mutableMapOf<String, String>()

    fun onRequests(requests: List<RemotePendingRequest>): List<AlertChange> {
        val now = requests.associateBy { requestKey(it.threadId, it.requestId) }
        val changes = mutableListOf<AlertChange>()
        for ((key, request) in now) {
            if (announced.add(key)) changes += AlertChange.Post(key, AlertKind.NEEDS_YOU, request.title, request.threadTitle, AlertTarget.Request(request.threadId, request.requestId))
        }
        val gone = announced.filter { it.startsWith(REQUEST) && it !in now }
        for (key in gone) {
            announced.remove(key)
            changes += AlertChange.Cancel(key)
        }
        return changes
    }

    fun onThreads(threads: List<RemoteThreadSummary>): List<AlertChange> {
        val changes = mutableListOf<AlertChange>()
        for (thread in threads) {
            val before = lastStatus.put(thread.id, thread.status)
            if (before != "running" || thread.status == "running") continue
            val key = "$THREAD${thread.id}"
            when {
                thread.status == "failed" || thread.lastTurnStatus == "failed" ->
                    changes += AlertChange.Post(key, AlertKind.FAILED, thread.title, "", AlertTarget.Thread(thread.id))
                thread.lastTurnStatus == "completed" ->
                    changes += AlertChange.Post(key, AlertKind.DONE, thread.title, "", AlertTarget.Thread(thread.id))
            }
        }
        // A conversation that starts working again makes its last "done" or "failed" stale.
        for (thread in threads) if (thread.status == "running") changes += AlertChange.Cancel("$THREAD${thread.id}")
        return changes
    }

    companion object {
        private const val REQUEST = "request:"
        private const val THREAD = "thread:"
        fun requestKey(threadId: String, requestId: String) = "$REQUEST$threadId/$requestId"
    }
}
