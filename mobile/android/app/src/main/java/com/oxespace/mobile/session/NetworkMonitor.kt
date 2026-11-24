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
 * OXE-383: with "Connect over a VPN" on ([vpnAllowed], off by default), a network that carries TRANSPORT_VPN counts
 * too, and [onVpn] says so; plain mobile data never does.
 */
class NetworkMonitor(context: Context, private val vpnAllowed: () -> Boolean = { false }) {
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    private val lan = MutableStateFlow(isLan(connectivity.getNetworkCapabilities(connectivity.activeNetwork)))
    val onLan: StateFlow<Boolean> = lan.asStateFlow()
    private val vpn = MutableStateFlow(hasVpn(connectivity.getNetworkCapabilities(connectivity.activeNetwork)))
    val onVpn: StateFlow<Boolean> = vpn.asStateFlow()

    init {
        connectivity.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                lan.value = isLan(capabilities)
                vpn.value = hasVpn(capabilities)
            }

            override fun onLost(network: Network) {
                lan.value = false
                vpn.value = false
            }
        })
    }

    private fun transports(capabilities: NetworkCapabilities?): Set<Int> =
        if (capabilities == null) emptySet() else WATCHED.filterTo(mutableSetOf()) { capabilities.hasTransport(it) }

    private fun isLan(capabilities: NetworkCapabilities?): Boolean = reachableTransport(transports(capabilities), vpnAllowed())

    private fun hasVpn(capabilities: NetworkCapabilities?): Boolean = NetworkCapabilities.TRANSPORT_VPN in transports(capabilities)

    companion object {
        private val WATCHED = listOf(
            NetworkCapabilities.TRANSPORT_WIFI,
            NetworkCapabilities.TRANSPORT_ETHERNET,
            NetworkCapabilities.TRANSPORT_CELLULAR,
            NetworkCapabilities.TRANSPORT_VPN,
        )

        /** Wi-Fi or Ethernet always; a VPN only with the person's opt-in; mobile data alone never. */
        fun reachableTransport(transports: Set<Int>, vpnAllowed: Boolean): Boolean =
            NetworkCapabilities.TRANSPORT_WIFI in transports || NetworkCapabilities.TRANSPORT_ETHERNET in transports ||
                (vpnAllowed && NetworkCapabilities.TRANSPORT_VPN in transports)
    }
}
