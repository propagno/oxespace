package com.oxespace.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalNetworkAccessTest {
    @Test
    fun asksOnlyWhereAndroidEnforcesIt() {
        // Android 16 and older don't know the permission: asking would be refused forever, so the gate stays open.
        assertFalse(LocalNetworkAccess.required(36))
        assertFalse(LocalNetworkAccess.required(28))
        assertTrue(LocalNetworkAccess.required(37))
        assertTrue(LocalNetworkAccess.required(38))
        assertEquals("android.permission.ACCESS_LOCAL_NETWORK", LocalNetworkAccess.PERMISSION)
    }
}
