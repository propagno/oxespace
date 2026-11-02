package com.oxespace.mobile.session

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import com.oxespace.mobile.OxeApplication
import com.oxespace.mobile.notify.SessionService
import kotlinx.coroutines.flow.StateFlow

/** The screens' view of the process-wide session; the foreground service keeps it running in the background. */
class SessionViewModel(application: Application) : AndroidViewModel(application) {
    private val core = (application as OxeApplication).core
    val live: LiveRepository = core.live
    val status: StateFlow<DesktopStatus> = core.status

    /** The app is on screen: make sure the session and its service run (only possible from the foreground). */
    fun onVisible() {
        core.inForeground = true
        if (core.isPaired()) SessionService.start(getApplication()) else core.start()
    }

    fun onHidden() {
        core.inForeground = false
    }

    fun start() = onVisible()
    fun retry() = core.retry()
    fun unpair() = core.unpair()
    fun setManualHost(host: String): Boolean = core.setManualHost(host)
}
