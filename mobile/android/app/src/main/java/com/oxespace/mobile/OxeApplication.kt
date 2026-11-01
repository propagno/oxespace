package com.oxespace.mobile

import android.app.Application
import com.oxespace.mobile.session.SessionCore

/** Holds the process-wide session, shared by the screens and the foreground service. */
class OxeApplication : Application() {
    val core: SessionCore by lazy { SessionCore(this) }
}
