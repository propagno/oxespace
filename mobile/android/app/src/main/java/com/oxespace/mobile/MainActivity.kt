package com.oxespace.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.oxespace.mobile.pairing.PairingViewModel
import com.oxespace.mobile.session.SessionViewModel
import com.oxespace.mobile.ui.HomeScreen
import com.oxespace.mobile.ui.pairing.CameraWithPermission
import com.oxespace.mobile.ui.pairing.PairingScreen
import com.oxespace.mobile.ui.theme.OxeTheme

class MainActivity : ComponentActivity() {
    private val session: SessionViewModel by viewModels()
    private val pairing: PairingViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            OxeTheme {
                var showPairing by rememberSaveable { mutableStateOf(false) }
                if (showPairing) {
                    val state by pairing.state.collectAsStateWithLifecycle()
                    BackHandler { showPairing = false }
                    PairingScreen(
                        state = state,
                        onScanAgain = pairing::scanAgain,
                        onDone = {
                            showPairing = false
                            session.start()
                        },
                        camera = { modifier -> CameraWithPermission(stringResource(R.string.pairing_camera_description), pairing::onScanned, modifier) },
                    )
                } else {
                    val status by session.status.collectAsStateWithLifecycle()
                    HomeScreen(
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

    /** The session runs while the app is visible; staying connected in the background is M6's service. */
    override fun onStart() {
        super.onStart()
        session.start()
    }

    override fun onStop() {
        session.stop()
        super.onStop()
    }
}
