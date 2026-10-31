package com.oxespace.mobile.session

import com.oxespace.mobile.pairing.DeviceKeys
import com.oxespace.mobile.pairing.PairedDesktop
import com.oxespace.mobile.pairing.PairedDesktopStore
import com.oxespace.mobile.protocol.pairing.LanAddress
import com.oxespace.mobile.protocol.session.DesktopTarget
import com.oxespace.mobile.protocol.session.SessionEnd
import com.oxespace.mobile.protocol.session.SessionLink
import com.oxespace.mobile.protocol.session.SessionState
import com.oxespace.mobile.protocol.session.TokenHolder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What the home screen says about the paired desktop. */
sealed interface DesktopStatus {
    /** Nothing paired. [revokedFrom] names the desktop that just removed this phone, to say so once. */
    data class Unpaired(val revokedFrom: String? = null, val revoked: Boolean = false) : DesktopStatus
    data class Connecting(val desktop: PairedDesktop) : DesktopStatus
    data class Connected(val desktop: PairedDesktop, val desktopName: String?) : DesktopStatus
    /** Off, on another network, or the gateway is turned off. The person can retry or type the address. */
    data class Unreachable(val desktop: PairedDesktop) : DesktopStatus
    /** The desktop speaks another version or broke the protocol: update one side. */
    data class Incompatible(val desktop: PairedDesktop) : DesktopStatus
    /** The desktop no longer accepts this phone's key, without saying it was removed: pair again. */
    data class NotAccepted(val desktop: PairedDesktop) : DesktopStatus
}

/**
 * Keeps one session with the paired desktop while the app is in use. It remembers the address that answered,
 * tries a typed one after it, and on `revoked` deletes the device key and the pairing: a removed phone keeps nothing.
 * The token lives in [tokens] only, in memory.
 */
class DesktopSessionController(
    private val scope: CoroutineScope,
    private val store: PairedDesktopStore,
    private val keysFor: (alias: String) -> DeviceKeys,
    private val linkFor: (target: DesktopTarget, keys: DeviceKeys, tokens: TokenHolder) -> SessionLink,
) {
    private val tokens = TokenHolder()
    private val mutableStatus = MutableStateFlow(initial())
    val status: StateFlow<DesktopStatus> = mutableStatus.asStateFlow()

    private var link: SessionLink? = null
    private var watcher: Job? = null

    private fun initial(): DesktopStatus = store.load()?.let { DesktopStatus.Connecting(it) } ?: DesktopStatus.Unpaired()

    /** Connects to the paired desktop, if there is one and no session is running. */
    fun start() {
        if (link != null) return
        val desktop = store.load() ?: run {
            if (mutableStatus.value !is DesktopStatus.Unpaired) mutableStatus.value = DesktopStatus.Unpaired()
            return
        }
        val keys = keysFor(desktop.keyAlias)
        val hosts = listOfNotNull(desktop.host, desktop.manualHost).distinct()
        val session = linkFor(DesktopTarget(desktop.deviceId, desktop.fingerprint, desktop.port, hosts), keys, tokens)
        link = session
        mutableStatus.value = DesktopStatus.Connecting(desktop)
        watcher = scope.launch { session.state.collect { onState(desktop, keys, session, it) } }
        session.connect()
    }

    /** Ends the session (app in the background); the token stays in memory for the next start. */
    fun stop() {
        watcher?.cancel()
        watcher = null
        link?.close()
        link = null
    }

    /** Tries again from the start, e.g. after the person turned the gateway on. */
    fun retry() {
        stop()
        start()
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

    private fun onState(desktop: PairedDesktop, keys: DeviceKeys, session: SessionLink, state: SessionState) {
        mutableStatus.value = when (state) {
            SessionState.Opening, SessionState.Authenticating -> DesktopStatus.Connecting(desktop)
            is SessionState.Ready -> {
                // Remember where it answered, so the next start goes there first.
                val host = session.connectedHost
                if (host != null && host != desktop.host) store.save((store.load() ?: desktop).copy(host = host))
                DesktopStatus.Connected(desktop, state.desktopName ?: desktop.desktopName)
            }
            is SessionState.Ended -> when (state.reason) {
                SessionEnd.REVOKED -> {
                    keys.delete()
                    store.clear()
                    tokens.token = null
                    link = null
                    DesktopStatus.Unpaired(revokedFrom = desktop.desktopName, revoked = true)
                }
                SessionEnd.CLOSED -> DesktopStatus.Unreachable(desktop)
                SessionEnd.UNSUPPORTED_VERSION, SessionEnd.PROTOCOL -> DesktopStatus.Incompatible(desktop)
                SessionEnd.UNAUTHENTICATED -> DesktopStatus.NotAccepted(desktop)
            }
        }
        if (state is SessionState.Ended) {
            link = null
            watcher?.cancel()
        }
    }
}
