package com.oxespace.mobile.protocol.session

import com.oxespace.mobile.protocol.FrameRead
import com.oxespace.mobile.protocol.FrameSource
import com.oxespace.mobile.protocol.RemoteFrame
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.pairing.LanAddress
import com.oxespace.mobile.protocol.pairing.PinnedTls
import java.net.InetAddress
import java.util.UUID
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/** The paired desktop as the connection needs it. The pin, not the address, says who it is. */
data class DesktopTarget(
    val deviceId: String,
    val fingerprint: String,
    val port: Int,
    /** Where to look, in order: the last address that answered, then the one the person typed. */
    val hosts: List<String>,
)

/**
 * One WSS session with the paired desktop over TLS pinned to its certificate. Tries each address in turn until one
 * answers with that certificate; runs [SessionProtocol] on the frames and renews the token on [scheduler] before it
 * expires. Reconnecting after a drop is the caller's choice (M6), so a revocation is never retried.
 */
class RemoteConnection(
    private val target: DesktopTarget,
    private val sign: (ByteArray) -> ByteArray,
    private val tokens: TokenHolder,
    private val scheduler: ScheduledExecutorService,
    private val clientFor: (fingerprint: String) -> OkHttpClient = { PinnedTls.client(it) },
    private val hostAllowed: (String) -> Boolean = LanAddress::isPrivate,
    private val now: () -> Long = { System.nanoTime() / 1_000_000 },
) {
    private val lock = Any()
    private val mutableState = MutableStateFlow<SessionState>(SessionState.Opening)
    val state: StateFlow<SessionState> = mutableState.asStateFlow()

    /** The address that answered, to try first next time. */
    @Volatile var connectedHost: String? = null
        private set

    private var protocol: SessionProtocol? = null
    private var socket: WebSocket? = null
    private var renewal: ScheduledFuture<*>? = null
    private var closedByUs = false

    fun connect() = tryHost(0)

    fun close() {
        synchronized(lock) {
            closedByUs = true
            renewal?.cancel(false)
            socket?.close(NORMAL, null)
            val session = protocol
            if (session == null) {
                mutableState.value = SessionState.Ended(SessionEnd.CLOSED)
            } else {
                session.onClosed()
                mutableState.value = session.state
            }
        }
    }

    private fun tryHost(index: Int) {
        val host = target.hosts.getOrNull(index)
        if (host == null || closedByUs) {
            synchronized(lock) { if (protocol == null) mutableState.value = SessionState.Ended(SessionEnd.CLOSED) }
            return
        }
        val url = urlFor(host) ?: return tryHost(index + 1)
        clientFor(target.fingerprint).newWebSocket(Request.Builder().url(url).build(), Listener(index, host))
    }

    /** `https` so OkHttp builds the URL; it upgrades to WSS. Literal addresses only, never a name lookup. */
    private fun urlFor(host: String): HttpUrl? {
        if (!hostAllowed(host)) return null
        val literal = try {
            InetAddress.getByName(if (host.contains(':')) "[$host]" else host).hostAddress
        } catch (_: java.io.IOException) {
            return null
        }
        return HttpUrl.Builder().scheme("https").host(literal).port(target.port).encodedPath(REMOTE_WS_PATH).build()
    }

    private inner class Listener(private val index: Int, private val host: String) : WebSocketListener() {
        private var opened = false

        override fun onOpen(webSocket: WebSocket, response: Response) {
            synchronized(lock) {
                if (closedByUs) {
                    webSocket.close(NORMAL, null)
                    return
                }
                opened = true
                socket = webSocket
                connectedHost = host
                val session = SessionProtocol(target.deviceId, target.fingerprint, sign, tokens, now, { UUID.randomUUID().toString() })
                protocol = session
                send(webSocket, session.onOpen())
                publish(session)
            }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            synchronized(lock) {
                val session = protocol ?: return
                when (val read = RemoteFrames.read(text, FrameSource.DESKTOP)) {
                    is FrameRead.Refused -> session.onUnreadable()
                    is FrameRead.Ok -> send(webSocket, session.onFrame(read.frame))
                }
                publish(session)
                if (session.state is SessionState.Ended) webSocket.close(NORMAL, null)
            }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(NORMAL, null)
            ended()
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = ended()

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            // Before the session opened, this address didn't answer with the paired certificate: try the next one.
            if (!opened) return tryHost(index + 1)
            ended()
        }

        private fun ended() {
            synchronized(lock) {
                renewal?.cancel(false)
                val session = protocol ?: return
                session.onClosed()
                publish(session)
            }
        }
    }

    private fun send(webSocket: WebSocket, frames: List<RemoteFrame>) {
        for (frame in frames) webSocket.send(RemoteFrames.write(frame))
    }

    /** Publishes the state and (re)arms the renewal. Called with [lock] held. */
    private fun publish(session: SessionProtocol) {
        mutableState.value = session.state
        renewal?.cancel(false)
        val due = session.renewalDueAtMs() ?: return
        renewal = scheduler.schedule({
            synchronized(lock) {
                val webSocket = socket ?: return@synchronized
                send(webSocket, session.renew())
                publish(session)
            }
        }, (due - now()).coerceAtLeast(0), TimeUnit.MILLISECONDS)
    }

    private companion object {
        const val NORMAL = 1000
    }
}
