package com.oxespace.mobile

import android.content.Intent
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ApplicationProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.oxespace.mobile.pairing.PairLinkForHomologation
import com.oxespace.mobile.pairing.PairingState
import com.oxespace.mobile.pairing.PairingViewModel
import com.oxespace.mobile.protocol.FrameRead
import com.oxespace.mobile.protocol.FrameSource
import com.oxespace.mobile.protocol.RemoteAckFrame
import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemoteErrorFrame
import com.oxespace.mobile.protocol.RemoteEventFrame
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemoteHelloFrame
import com.oxespace.mobile.protocol.RemoteSnapshotFrame
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeFalse
import org.junit.Test
import org.junit.runner.RunWith

/**
 * MB-M-03: what R8 could break in the shipped build, run against it (the `minified` build type, the release build with
 * the debug key) before the release workflow attaches the APK. The app starts, and every kind of frame the desktop
 * sends is read through the generated serializers, wire names and enum values included; the debug-only pairing link is
 * ignored. Also passes on debug, where that last check is skipped.
 */
@RunWith(AndroidJUnit4::class)
class ReleaseSmokeTest {
    private val challenge = "A".repeat(43)

    private fun read(text: String) = RemoteFrames.read(text, FrameSource.DESKTOP)

    @Test
    fun startsAndShowsItsFirstScreen() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.moveToState(Lifecycle.State.RESUMED)
            scenario.onActivity { assertTrue(!it.isFinishing) }
        }
    }

    @Test
    fun theShippedBuildIgnoresAPairingLinkHandedOverAdb() {
        // On debug this is the homologation path; what matters is the build that ships.
        assumeFalse(BuildConfig.DEBUG)
        val link = "oxespace://pair?v=1&host=192.168.0.12&port=7443&fp=${"b".repeat(64)}&code=AbCdEfGhIjKlMnOpQrSt_-&name=Studio"
        assertNull(PairLinkForHomologation.read(BuildConfig.DEBUG, link))
        // Through the exported launcher, as adb or another app would send it: the pairing never leaves "scanning".
        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java).putExtra(PairLinkForHomologation.EXTRA, link)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            scenario.moveToState(Lifecycle.State.RESUMED)
            Thread.sleep(1_000)
            scenario.onActivity { activity ->
                assertEquals(PairingState.Scanning, ViewModelProvider(activity)[PairingViewModel::class.java].state.value)
            }
        }
    }

    @Test
    fun readsEveryKindOfDesktopFrame() {
        val hello = (read("""{"type":"hello","versions":[1],"desktopName":"Studio","challenge":"$challenge"}""") as FrameRead.Ok).frame
        // Only what the app itself reads: a constructor it never calls is rightly gone from the shrunk build.
        hello as RemoteHelloFrame
        assertEquals(listOf(1L), hello.versions)
        assertEquals("Studio", hello.desktopName)
        assertEquals(challenge, hello.challenge)

        val ack = (read("""{"type":"ack","id":"a1","result":{"accessToken":"t","expiresInMs":900000}}""") as FrameRead.Ok).frame
        assertEquals("a1", (ack as RemoteAckFrame).id)

        val error = (read("""{"type":"error","id":"a2","code":"token-expired"}""") as FrameRead.Ok).frame
        assertEquals(RemoteErrorCode.TOKEN_EXPIRED, (error as RemoteErrorFrame).code)

        val snapshot = (read("""{"type":"snapshot","subscription":"s1","seq":1,"schemaVersion":1,"data":{"items":[]},"page":{"index":0,"last":true}}""") as FrameRead.Ok).frame
        assertEquals(true, (snapshot as RemoteSnapshotFrame).page?.last)

        val event = (read("""{"type":"event","subscription":"s1","seq":2,"schemaVersion":1,"data":{"op":"upsert"}}""") as FrameRead.Ok).frame
        assertEquals(2L, (event as RemoteEventFrame).seq)

        // What isn't C5 is still refused, not crashed on.
        assertEquals(FrameRead.Refused(RemoteErrorCode.MALFORMED), read("""{"type":"teleport"}"""))
    }
}
