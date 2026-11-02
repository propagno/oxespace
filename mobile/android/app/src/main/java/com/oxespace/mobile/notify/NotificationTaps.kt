package com.oxespace.mobile.notify

import android.content.Intent
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/** Where a tap asked to go: a request (thread and request ids) or a conversation. */
data class TapTarget(val threadId: String, val requestId: String?)

/**
 * The launcher activity is exported, so any app can start it with a thread or request id (MB-M-07). Only the app's
 * own notifications know this process's token, and their PendingIntents are immutable; an intent without it opens the
 * app where it was, never a conversation or request someone else picked. A notification from before the process
 * restarted has the old token and just opens the app.
 */
object NotificationTaps {
    private const val EXTRA_TOKEN = "tap"
    private val token: String = ByteArray(32).also(SecureRandom()::nextBytes).let { Base64.getUrlEncoder().withoutPadding().encodeToString(it) }

    fun sign(intent: Intent): Intent = intent.putExtra(EXTRA_TOKEN, token)

    fun read(intent: Intent?): TapTarget? {
        if (intent == null) return null
        return target(intent.getStringExtra(EXTRA_TOKEN), intent.getStringExtra(Notifications.EXTRA_THREAD), intent.getStringExtra(Notifications.EXTRA_REQUEST))
    }

    /** The check itself, apart from Intent, so a plain unit test covers it. */
    internal fun target(tapToken: String?, threadId: String?, requestId: String?): TapTarget? {
        if (tapToken == null || threadId.isNullOrEmpty()) return null
        if (!MessageDigest.isEqual(tapToken.toByteArray(), token.toByteArray())) return null
        return TapTarget(threadId, requestId?.takeIf { it.isNotEmpty() })
    }

    internal val currentToken: String get() = token
}
