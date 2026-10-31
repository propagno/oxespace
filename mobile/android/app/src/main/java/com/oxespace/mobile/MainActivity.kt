package com.oxespace.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.oxespace.mobile.pairing.AndroidKeystoreDeviceKeys
import com.oxespace.mobile.pairing.PairingViewModel
import com.oxespace.mobile.pairing.PreferencesPairedDesktopStore
import com.oxespace.mobile.ui.HomeScreen
import com.oxespace.mobile.ui.pairing.CameraWithPermission
import com.oxespace.mobile.ui.pairing.PairingScreen
import com.oxespace.mobile.ui.theme.OxeTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val store = PreferencesPairedDesktopStore(this)
        setContent {
            OxeTheme {
                // Read again whenever the activity is recreated, so the store stays the only source of truth.
                var paired by remember { mutableStateOf(store.load()) }
                var pairing by rememberSaveable { mutableStateOf(false) }
                val model: PairingViewModel = viewModel()
                if (pairing) {
                    val state by model.state.collectAsStateWithLifecycle()
                    BackHandler { pairing = false }
                    PairingScreen(
                        state = state,
                        onScanAgain = model::scanAgain,
                        onDone = {
                            paired = store.load()
                            pairing = false
                        },
                        camera = { modifier -> CameraWithPermission(stringResource(R.string.pairing_camera_description), model::onScanned, modifier) },
                    )
                } else {
                    HomeScreen(
                        paired = paired,
                        onPair = {
                            model.scanAgain()
                            pairing = true
                        },
                        onUnpair = {
                            paired?.let { AndroidKeystoreDeviceKeys(this, it.keyAlias).delete() }
                            store.clear()
                            paired = null
                        },
                    )
                }
            }
        }
    }
}

