package com.oxespace.mobile.protocol.pairing

import com.oxespace.mobile.protocol.REMOTE_RESERVED_NAMES
import com.oxespace.mobile.protocol.REMOTE_RESERVED_NAME_FRAGMENTS
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceNamesTest {
    @Test
    fun dropsInvisibleAndDirectionCharactersBeforeSending() {
        // Zero-width space, right-to-left override, left-to-right mark, a tag character, a control character.
        assertEquals("Pixel 8", pairingDeviceName("‮Pixel​ 8‎󠁁\u0007"))
        assertEquals("Android", pairingDeviceName("​⁠ ﻿"))
        assertEquals(64, pairingDeviceName("x".repeat(100)).length)
    }

    @Test
    fun refusesAProductNameAnywhereInTheName() {
        for (fragment in REMOTE_RESERVED_NAME_FRAGMENTS) {
            assertTrue(fragment, isReservedDeviceName(fragment))
            assertTrue(fragment, isReservedDeviceName("Phone of ${fragment.lowercase()}: update"))
        }
        // Hidden characters don't get a name past the check.
        assertTrue(isReservedDeviceName("OXE​Space"))
    }

    @Test
    fun refusesAGenericWordOnlyAsTheWholeName() {
        for (word in REMOTE_RESERVED_NAMES) {
            assertTrue(word, isReservedDeviceName(word))
            assertTrue(word, isReservedDeviceName("  ${word.uppercase()}​ "))
        }
        for (name in listOf("filesystem", "Apple iPhone", "Sistema da Ana", "My App phone", "Pixel 8", "Galaxy S24")) {
            assertFalse(name, isReservedDeviceName(name))
        }
    }
}
