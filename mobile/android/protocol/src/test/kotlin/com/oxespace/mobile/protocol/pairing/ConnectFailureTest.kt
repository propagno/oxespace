package com.oxespace.mobile.protocol.pairing

import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketException
import java.net.SocketTimeoutException
import org.junit.Assert.assertEquals
import org.junit.Test

/** The messages are Android's own (libcore writes the errno into the text), as a real phone reports them. */
class ConnectFailureTest {
    private val to = "failed to connect to /192.168.0.85 (port 47321) from /:: (port 0) after 10000ms"

    @Test
    fun androidRefusingTheSocketOnThePhoneIsBlockedOnPhone() {
        // Android 17 without ACCESS_LOCAL_NETWORK: the 1.4.1 user's fast "Couldn't reach your computer".
        assertEquals(ConnectFailure.BLOCKED_ON_PHONE, ConnectFailure.of(ConnectException("$to: connect failed: EPERM (Operation not permitted)")))
        assertEquals(ConnectFailure.BLOCKED_ON_PHONE, ConnectFailure.of(SocketException("socket failed: EACCES (Permission denied)")))
    }

    @Test
    fun aRefusalFromTheComputerIsRefused() {
        assertEquals(ConnectFailure.REFUSED, ConnectFailure.of(ConnectException("$to: connect failed: ECONNREFUSED (Connection refused)")))
        assertEquals(ConnectFailure.REFUSED, ConnectFailure.of(ConnectException("Connection refused")))
    }

    @Test
    fun noAnswerInTimeIsTimedOut() {
        assertEquals(ConnectFailure.TIMED_OUT, ConnectFailure.of(SocketTimeoutException(to)))
        assertEquals(ConnectFailure.TIMED_OUT, ConnectFailure.of(ConnectException("$to: connect failed: ETIMEDOUT (Connection timed out)")))
        // OkHttp's call timeout.
        assertEquals(ConnectFailure.TIMED_OUT, ConnectFailure.of(InterruptedIOException("timeout")))
    }

    @Test
    fun noRouteOrAnythingElseIsNoRoute() {
        assertEquals(ConnectFailure.NO_ROUTE, ConnectFailure.of(NoRouteToHostException("$to: connect failed: EHOSTUNREACH (No route to host)")))
        assertEquals(ConnectFailure.NO_ROUTE, ConnectFailure.of(ConnectException("$to: connect failed: ENETUNREACH (Network is unreachable)")))
        assertEquals(ConnectFailure.NO_ROUTE, ConnectFailure.of(IOException("unexpected end of stream")))
    }

    @Test
    fun readsTheCauseWhenTheWrapperSaysLittle() {
        assertEquals(ConnectFailure.BLOCKED_ON_PHONE, ConnectFailure.of(IOException("connect failed", SocketException("EPERM (Operation not permitted)"))))
    }
}
