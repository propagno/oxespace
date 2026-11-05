package com.oxespace.mobile.protocol.pairing

import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException

/**
 * Why a connection to the desktop failed before it answered. Each one gets its own words on the phone, because each
 * has a different fix: 1.4.1 said "Couldn't reach your computer" for all of them, and a real phone stayed stuck.
 */
enum class ConnectFailure {
    /** Android refused the socket itself (EPERM): local network access is off for the app (Android 17). */
    BLOCKED_ON_PHONE,
    /** The computer answered with a refusal (ECONNREFUSED): nothing listening, or a firewall that rejects. */
    REFUSED,
    /** No answer in time: a firewall that drops, a computer that's off, or another network. */
    TIMED_OUT,
    /** No route, or anything else: another Wi-Fi, a VPN, mobile data. */
    NO_ROUTE,
    ;

    companion object {
        /** Reads the exception and its causes. Android writes the errno into the message ("connect failed: EPERM …"). */
        fun of(error: IOException): ConnectFailure {
            val chain = generateSequence<Throwable>(error) { it.cause.takeIf { cause -> cause !== it } }.take(8).toList()
            val text = chain.joinToString(" | ") { "${it.javaClass.simpleName}: ${it.message.orEmpty()}" }
            return when {
                "EPERM" in text || "Operation not permitted" in text || "EACCES" in text || "Permission denied" in text -> BLOCKED_ON_PHONE
                "ECONNREFUSED" in text || "Connection refused" in text -> REFUSED
                chain.any { it is SocketTimeoutException } || "ETIMEDOUT" in text || "timed out" in text ||
                    chain.any { it is InterruptedIOException && it.message == "timeout" } -> TIMED_OUT
                chain.any { it is NoRouteToHostException } -> NO_ROUTE
                // A refusal with no errno in the message (the JVM's own wording varies).
                chain.any { it is ConnectException } && "refused" in text.lowercase() -> REFUSED
                else -> NO_ROUTE
            }
        }
    }
}
