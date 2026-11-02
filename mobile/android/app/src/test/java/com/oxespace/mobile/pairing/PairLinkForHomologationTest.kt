package com.oxespace.mobile.pairing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PairLinkForHomologationTest {
    private val link = "oxespace://pair?v=1&host=192.168.0.12&port=7443&fp=${"b".repeat(64)}&code=AbCdEfGhIjKlMnOpQrSt_-&name=Studio"

    @Test
    fun aDebugBuildScansTheLinkItWasHanded() {
        assertEquals(link, PairLinkForHomologation.read(debug = true, link = link))
    }

    @Test
    fun aReleaseBuildIgnoresItWhateverItSays() {
        assertNull(PairLinkForHomologation.read(debug = false, link = link))
        assertNull(PairLinkForHomologation.read(debug = false, link = "anything"))
    }

    @Test
    fun nothingOrABlankLinkScansNothing() {
        assertNull(PairLinkForHomologation.read(debug = true, link = null))
        assertNull(PairLinkForHomologation.read(debug = true, link = "  "))
    }
}
