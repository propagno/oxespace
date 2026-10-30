package com.oxespace.mobile

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.oxespace.mobile.approval.KeystorePresence
import com.oxespace.mobile.approval.PresenceGate
import com.oxespace.mobile.notify.Notifications
import com.oxespace.mobile.pairing.PairedDesktop
import com.oxespace.mobile.pairing.PairingViewModel
import com.oxespace.mobile.session.DesktopStatus
import com.oxespace.mobile.session.SessionViewModel
import com.oxespace.mobile.ui.AddressDialog
import com.oxespace.mobile.ui.HomeScreen
import com.oxespace.mobile.ui.live.AskForNotifications
import com.oxespace.mobile.ui.live.LiveHome
import com.oxespace.mobile.ui.live.RequestScreen
import com.oxespace.mobile.ui.live.TerminalScreen
import com.oxespace.mobile.ui.live.ThreadScreen
import com.oxespace.mobile.ui.pairing.CameraWithPermission
import com.oxespace.mobile.ui.pairing.PairingScreen
import com.oxespace.mobile.ui.theme.OxeTheme

class MainActivity : ComponentActivity() {
    private val session: SessionViewModel by viewModels()
    private val pairing: PairingViewModel by viewModels()

    /** Where a tapped notification asked to go: a request (thread id, request id) or a conversation. */
    private var opening by mutableStateOf<Pair<String, String?>?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        readNotificationTap(intent)
        setContent {
            OxeTheme {
                var showPairing by rememberSaveable { mutableStateOf(false) }
                val status by session.status.collectAsStateWithLifecycle()
                // Once connected, a drop keeps the person where they were and says so; the home is for before that.
                var wasConnected by rememberSaveable { mutableStateOf(false) }
                if (status is DesktopStatus.Connected) wasConnected = true
                if (status is DesktopStatus.Unpaired) wasConnected = false
                val liveDesktop = when (val current = status) {
                    is DesktopStatus.Connected -> current.desktop
                    is DesktopStatus.Reconnecting -> current.desktop.takeIf { wasConnected }
                    is DesktopStatus.Unreachable -> current.desktop.takeIf { wasConnected }
                    is DesktopStatus.OffNetwork -> current.desktop.takeIf { wasConnected }
                    else -> null
                }
                when {
                    showPairing -> Pairing(onDone = { showPairing = false; session.start() }, onBack = { showPairing = false })
                    liveDesktop != null -> Live(liveDesktop, status)
                    else -> HomeScreen(
                        status = status,
                        onPair = {
                            pairing.scanAgain()
                            showPairing = true
                        },
                        onRetry = session::retry,
                        onManualHost = session::setManualHost,
                        onUnpair = session::unpair,
                    )
                }
            }
        }
    }

    @Composable
    private fun Pairing(onDone: () -> Unit, onBack: () -> Unit) {
        val state by pairing.state.collectAsStateWithLifecycle()
        BackHandler(onBack = onBack)
        PairingScreen(
            state = state,
            onScanAgain = pairing::scanAgain,
            onDone = onDone,
            camera = { modifier -> CameraWithPermission(stringResource(R.string.pairing_camera_description), pairing::onScanned, modifier) },
        )
    }

    /** The connected app: the live home, one conversation or one terminal at a time, with Back to return. */
    @Composable
    private fun Live(desktop: PairedDesktop, status: DesktopStatus) {
        val live = session.live
        // One window for the whole app: proving presence in a conversation also covers a terminal opened right after.
        val presence = remember { PresenceGate(KeystorePresence(applicationContext)) }
        var threadId by rememberSaveable { mutableStateOf<String?>(null) }
        var paneId by rememberSaveable { mutableStateOf<String?>(null) }
        var requestKey by rememberSaveable { mutableStateOf<String?>(null) }
        val requests by live.pendingRequests.items.collectAsStateWithLifecycle()
        var askingAddress by rememberSaveable { mutableStateOf(false) }
        AskForNotifications()
        // A tapped notification: open its request or conversation, once.
        val tap = opening
        LaunchedEffect(tap) {
            if (tap != null) {
                val (thread, request) = tap
                if (request != null) requestKey = "$thread/$request" else threadId = thread
                opening = null
            }
        }
        val workspaces by live.workspaces.items.collectAsStateWithLifecycle()
        val name = (status as? DesktopStatus.Connected)?.desktopName ?: desktop.desktopName ?: stringResource(R.string.home_unknown_desktop)
        val banner = when (status) {
            is DesktopStatus.Reconnecting -> stringResource(R.string.home_status_reconnecting, name)
            is DesktopStatus.Unreachable -> stringResource(R.string.home_status_unreachable, name)
            is DesktopStatus.OffNetwork -> stringResource(R.string.home_status_off_network, name)
            else -> null
        }

        val openThread = threadId
        val openPane = paneId?.let { id -> workspaces.flatMap { it.panes }.firstOrNull { it.id == id } }
        val openRequest = requestKey
        when {
            openRequest != null -> {
                BackHandler { requestKey = null }
                // The request as it is now; null once answered elsewhere, and the screen says so.
                RequestScreen(requests.firstOrNull { "${it.threadId}/${it.requestId}" == openRequest }, live.streams.commands, onBack = { requestKey = null })
            }
            openThread != null -> {
                val watched = live.openThread(openThread)
                DisposableEffect(openThread) { onDispose { live.closeThread(openThread) } }
                BackHandler { threadId = null }
                ThreadScreen(openThread, watched, live.streams.commands, presence, connected = status is DesktopStatus.Connected, onBack = { threadId = null })
            }
            openPane != null -> {
                val watched = live.openTerminal(openPane.id)
                DisposableEffect(openPane.id) { onDispose { live.closeTerminal(openPane.id) } }
                BackHandler { paneId = null }
                TerminalScreen(openPane, watched, live.streams.commands, presence, onBack = { paneId = null })
            }
            else -> LiveHome(
                desktopName = name,
                banner = banner,
                live = live,
                onOpenThread = { threadId = it },
                onOpenRequest = { requestKey = "${it.threadId}/${it.requestId}" },
                onOpenTerminal = { paneId = it.id },
                onEnterAddress = { askingAddress = true },
                onUnpair = session::unpair,
            )
        }
        if (askingAddress) AddressDialog(initial = desktop.manualHost.orEmpty(), onSave = session::setManualHost, onDismiss = { askingAddress = false })
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        readNotificationTap(intent)
    }

    private fun readNotificationTap(intent: Intent?) {
        val thread = intent?.getStringExtra(Notifications.EXTRA_THREAD) ?: return
        opening = thread to intent.getStringExtra(Notifications.EXTRA_REQUEST)
    }

    /** On screen the session runs here; in the background the foreground service keeps it. */
    override fun onStart() {
        super.onStart()
        session.onVisible()
    }

    override fun onStop() {
        session.onHidden()
        super.onStop()
    }
}
