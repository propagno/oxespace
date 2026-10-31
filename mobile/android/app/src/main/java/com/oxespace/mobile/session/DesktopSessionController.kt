package com.oxespace.mobile.session

import com.oxespace.mobile.pairing.DeviceKeys
import com.oxespace.mobile.pairing.PairedDesktop
import com.oxespace.mobile.pairing.PairedDesktopStore
import com.oxespace.mobile.protocol.pairing.LanAddress
import com.oxespace.mobile.protocol.session.Backoff
import com.oxespace.mobile.protocol.session.DesktopTarget
import com.oxespace.mobile.protocol.session.SessionEnd
import com.oxespace.mobile.protocol.session.SessionLink
import com.oxespace.mobile.protocol.session.SessionState
import com.oxespace.mobile.protocol.session.TokenHolder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What the home screen and the persistent notification say about the paired desktop. */
sealed interface DesktopStatus {
    /** Nothing paired. [revokedFrom] names the desktop that just removed this phone, to say so once. */
    data class Unpaired(val revokedFrom: String? = null, val revoked: Boolean = false) : DesktopStatus
    data class Connecting(val desktop: PairedDesktop) : DesktopStatus
    data class Connected(val desktop: PairedDesktop, val desktopName: String?) : DesktopStatus
    /** A live session dropped (desktop asleep, Wi-Fi blip): trying again right away. */
    data class Reconnecting(val desktop: PairedDesktop) : DesktopStatus
    /** No answer: the desktop is off, or its gateway is. Trying again after [retryInMs]. */
    data class Unreachable(val desktop: PairedDesktop, val retryInMs: Long) : DesktopStatus
    /** The phone left the local network (mobile data, no Wi-Fi): the desktop can only be reached on the same LAN. */
    data class OffNetwork(val desktop: PairedDesktop) : DesktopStatus
    /** The desktop speaks another version or broke the protocol: update one side. Not retried by itself. */
    data class Incompatible(val desktop: PairedDesktop) : DesktopStatus
    /** The desktop no longer accepts this phone's key, without saying it was removed: pair again. Not retried. */
    data class NotAccepted(val desktop: PairedDesktop) : DesktopStatus
}

/**
 * Keeps the session with the paired desktop for as long as it runs (the foreground service holds it in the
 * background). A dropped session is retried at once, then with [backoff]; leaving the local network pauses it and
 * coming back retries at once. It remembers the address that answered, tries a typed one after it, and on `revoked`
 * deletes the device key and the pairing: a removed phone keeps nothing. The token lives in [tokens] only.
 */
class DesktopSessionController(
    private val scope: CoroutineScope,
    private val store: PairedDesktopStore,
    private val keysFor: (alias: String) -> DeviceKeys,
    private val linkFor: (target: DesktopTarget, keys: DeviceKeys, tokens: TokenHolder) -> SessionLink,
    /** True while the phone is on Wi-Fi or Ethernet, where the desktop can be. */
    private val onLan: StateFlow<Boolean> = MutableStateFlow(true),
    private val backoff: Backoff = Backoff(),
) {
    private val tokens = TokenHolder()
    private val mutableStatus = MutableStateFlow(initial())
    val status: StateFlow<DesktopStatus> = mutableStatus.asStateFlow()

    private var running = false
    private var link: SessionLink? = null
    private var watcher: Job? = null
    private var retryJob: Job? = null
    private var networkJob: Job? = null
    private var attempt = 0

    private fun initial(): DesktopStatus = store.load()?.let { DesktopStatus.Connecting(it) } ?: DesktopStatus.Unpaired()

    /** Keeps the paired desktop connected until [stop]. */
    fun start() {
        if (running) return
        running = true
        networkJob = scope.launch {
            onLan.collect { lan -> if (lan) onLanBack() else onLanLost() }
        }
    }

    /** Ends the session and every retry; the token stays in memory for the next start. */
    fun stop() {
        running = false
        networkJob?.cancel()
        networkJob = null
        drop()
    }

    /** The person asked to try now: forget the wait and connect. */
    fun retry() {
        if (!running) return start()
        attempt = 0
        drop()
        connect()
    }

    /** An address the person typed; only a LAN address literal is kept. Returns whether it was accepted. */
    fun setManualHost(host: String): Boolean {
        val address = host.trim()
        if (!LanAddress.isPrivate(address)) return false
        val desktop = store.load() ?: return false
        store.save(desktop.copy(manualHost = address))
        retry()
        return true
    }

    /** Forgets the desktop on this phone: its key and the pairing. The desktop lists the phone until removed there. */
    fun unpair() {
        val desktop = store.load()
        stop()
        tokens.token = null
        desktop?.let { keysFor(it.keyAlias).delete() }
        store.clear()
        mutableStatus.value = DesktopStatus.Unpaired()
    }

    private fun onLanBack() {
        if (link != null) return
        attempt = 0
        connect()
    }

    private fun onLanLost() {
        drop()
        store.load()?.let { mutableStatus.value = DesktopStatus.OffNetwork(it) }
    }

    private fun drop() {
        retryJob?.cancel()
        retryJob = null
        watcher?.cancel()
        watcher = null
        link?.close()
        link = null
    }

    private fun connect() {
        retryJob?.cancel()
        retryJob = null
        if (!running || link != null) return
        val desktop = store.load() ?: run {
            if (mutableStatus.value !is DesktopStatus.Unpaired) mutableStatus.value = DesktopStatus.Unpaired()
            return
        }
        if (!onLan.value) {
            mutableStatus.value = DesktopStatus.OffNetwork(desktop)
            return
        }
        val keys = keysFor(desktop.keyAlias)
        val hosts = listOfNotNull(desktop.host, desktop.manualHost).distinct()
        val session = linkFor(DesktopTarget(desktop.deviceId, desktop.fingerprint, desktop.port, hosts), keys, tokens)
        link = session
        if (mutableStatus.value !is DesktopStatus.Reconnecting) mutableStatus.value = DesktopStatus.Connecting(desktop)
        watcher = scope.launch { session.state.collect { onState(desktop, keys, session, it) } }
        session.connect()
    }

    private fun onState(desktop: PairedDesktop, keys: DeviceKeys, session: SessionLink, state: SessionState) {
        if (session !== link) return
        when (state) {
            SessionState.Opening, SessionState.Authenticating -> Unit
            is SessionState.Ready -> {
                attempt = 0
                // Remember where it answered, so the next start goes there first.
                val host = session.connectedHost
                if (host != null && host != desktop.host) store.save((store.load() ?: desktop).copy(host = host))
                mutableStatus.value = DesktopStatus.Connected(desktop, state.desktopName ?: desktop.desktopName)
            }
            is SessionState.Ended -> {
                val wasConnected = mutableStatus.value is DesktopStatus.Connected
                watcher?.cancel()
                watcher = null
                link = null
                when (state.reason) {
                    SessionEnd.REVOKED -> {
                        running = false
                        networkJob?.cancel()
                        keys.delete()
                        store.clear()
                        tokens.token = null
                        mutableStatus.value = DesktopStatus.Unpaired(revokedFrom = desktop.desktopName, revoked = true)
                    }
                    SessionEnd.UNSUPPORTED_VERSION, SessionEnd.PROTOCOL -> mutableStatus.value = DesktopStatus.Incompatible(desktop)
                    SessionEnd.UNAUTHENTICATED -> mutableStatus.value = DesktopStatus.NotAccepted(desktop)
                    SessionEnd.CLOSED -> scheduleRetry(desktop, immediately = wasConnected)
                }
            }
        }
    }

    /** A dropped live session tries again at once; a desktop that doesn't answer is retried with growing waits. */
    private fun scheduleRetry(desktop: PairedDesktop, immediately: Boolean) {
        if (!running) return
        if (!onLan.value) {
            mutableStatus.value = DesktopStatus.OffNetwork(desktop)
            return
        }
        if (immediately) {
            mutableStatus.value = DesktopStatus.Reconnecting(desktop)
            connect()
            return
        }
        attempt++
        val wait = backoff.delayMs(attempt)
        mutableStatus.value = DesktopStatus.Unreachable(desktop, wait)
        retryJob = scope.launch {
            delay(wait)
            connect()
        }
    }
}
