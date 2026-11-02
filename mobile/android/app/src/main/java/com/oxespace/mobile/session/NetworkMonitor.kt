package com.oxespace.mobile.session

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Whether the phone's default network is Wi-Fi or Ethernet, where the desktop can be. On mobile data, or with no
 * network, the session pauses instead of retrying into the void, and resumes the moment the LAN is back.
 */
class NetworkMonitor(context: Context) {
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    private val lan = MutableStateFlow(isLan(connectivity.getNetworkCapabilities(connectivity.activeNetwork)))
    val onLan: StateFlow<Boolean> = lan.asStateFlow()

    init {
        connectivity.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                lan.value = isLan(capabilities)
            }

            override fun onLost(network: Network) {
                lan.value = false
            }
        })
    }

    private fun isLan(capabilities: NetworkCapabilities?): Boolean =
        capabilities != null && (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
}
