package com.oxespace.mobile.protocol

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors tests/remote-protocol-contract.test.ts, so both ends of C5 accept and refuse the same frames. */
class RemoteProtocolTest {
    /** Same list as the desktop test: words that name what stays with the person at the desktop. */
    private val forbiddenWords =
        Regex("approve|approval|confirm|trust|token|secret|password|credential|sign.?in|login|policy|access|exec|shell|spawn|vault", RegexOption.IGNORE_CASE)

    private fun refused(text: String, from: FrameSource = FrameSource.CLIENT) = (RemoteFrames.read(text, from) as? FrameRead.Refused)?.code

    private fun read(text: String, from: FrameSource): RemoteFrame {
        val result = RemoteFrames.read(text, from)
        assertTrue("$text → $result", result is FrameRead.Ok)
        return (result as FrameRead.Ok).frame
    }

    @Test
    fun keepsTheLimitsTheMobileRoadmapSets() {
        assertEquals(64 * 1024, RemoteLimits.MAX_FRAME_BYTES)
        assertEquals(15 * 60_000L, RemoteLimits.ACCESS_TOKEN_TTL_MS)
        assertEquals(2 * 60_000L, RemoteLimits.PAIRING_CODE_TTL_MS)
        assertEquals(5, RemoteLimits.MAX_DEVICES)
        assertTrue(REMOTE_PROTOCOL_VERSION >= 1)
    }

    @Test
    fun offersNoForbiddenCapability() {
        val offered = RemoteCommand.entries.map { it.wire } + RemoteSubscription.entries.map { it.wire }
        for (forbidden in REMOTE_FORBIDDEN) assertFalse(forbidden, forbidden in offered)
        assertEquals(emptyList<String>(), offered.filter { forbiddenWords.containsMatchIn(it) })
        assertTrue(REMOTE_FORBIDDEN.containsAll(listOf("oxequery.approve", "mcp.confirm", "mcp.trust", "accounts.signIn", "accounts.token", "secrets.read", "policy.edit", "host.exec")))
    }

    @Test
    fun thePhoneSendsOnlyClientFrames() {
        assertFalse(RemoteFrameType.EVENT in REMOTE_CLIENT_FRAMES)
        assertFalse(RemoteFrameType.SNAPSHOT in REMOTE_CLIENT_FRAMES)
        assertFalse(RemoteFrameType.ACK in REMOTE_CLIENT_FRAMES)
        assertFalse(RemoteFrameType.ERROR in REMOTE_CLIENT_FRAMES)
    }

    @Test
    fun refusesOversizedMalformedDesktopOnlyAndUnknownFrames() {
        assertEquals(RemoteErrorCode.FRAME_TOO_LARGE, refused("x".repeat(RemoteLimits.MAX_FRAME_BYTES + 1)))
        // Size is counted in bytes, not characters.
        val wide = """{"type":"hello","versions":[1],"pad":"${"é".repeat(RemoteLimits.MAX_FRAME_BYTES / 2)}"}"""
        assertEquals(RemoteErrorCode.FRAME_TOO_LARGE, refused(wide))
        for (text in listOf("", "not json", "[]", "null", "1", """{"type":"teleport"}""")) assertEquals(text, RemoteErrorCode.MALFORMED, refused(text))
        assertEquals(RemoteErrorCode.MALFORMED, refused("""{"type":"event","subscription":"s","seq":1,"schemaVersion":1,"data":{}}"""))
        assertEquals(RemoteErrorCode.UNKNOWN_COMMAND, refused("""{"type":"command","id":"1","command":"host.exec","args":{}}"""))
        assertEquals(RemoteErrorCode.UNKNOWN_COMMAND, refused("""{"type":"command","id":"1","command":"oxequery.approve","args":{}}"""))
    }

    @Test
    fun refusesDeepNestingBeforeParsing() {
        val nested = { levels: Int -> """{"type":"hello","versions":[1],"x":${"[".repeat(levels)}${"]".repeat(levels)}}""" }
        for (from in FrameSource.entries) {
            assertEquals(RemoteErrorCode.MALFORMED, refused(nested(20_000), from))
            assertEquals(RemoteErrorCode.MALFORMED, refused(nested(RemoteLimits.MAX_FRAME_DEPTH), from))
            read(nested(RemoteLimits.MAX_FRAME_DEPTH - 1), from)
        }
        // Brackets inside a string, escaped quotes included, are text, not nesting.
        read("""{"type":"hello","versions":[1],"note":"\\\"${"[".repeat(500)}"}""", FrameSource.CLIENT)
        // Closers ahead of the openers lower the count, but the parser stops at the first of them.
        assertEquals(RemoteErrorCode.MALFORMED, refused("]".repeat(10_000) + "{".repeat(10_000)))
    }

    @Test
    fun refusesDesktopFramesTooLargeEvenWhenMostlyWhitespace() {
        val padded = """{"type":"hello","versions":[1]${" ".repeat(RemoteLimits.MAX_FRAME_BYTES)}}"""
        assertEquals(RemoteErrorCode.FRAME_TOO_LARGE, refused(padded, FrameSource.DESKTOP))
        assertEquals(RemoteErrorCode.FRAME_TOO_LARGE, refused("{".repeat(10 * RemoteLimits.MAX_FRAME_BYTES), FrameSource.DESKTOP))
    }

    /**
     * OkHttp decodes a text frame with Okio, which turns bytes that aren't UTF-8 into U+FFFD, so the reader sees text
     * that is valid but changed. A lone surrogate is the closest a JVM string gets to an invalid sequence.
     */
    @Test
    fun readsTextThatWasNotUtf8WithoutThrowing() {
        val replaced = String(byteArrayOf(0xC3.toByte(), 0x28, 0xFF.toByte()), Charsets.UTF_8)
        assertTrue(replaced.contains('�'))
        val event = read("""{"type":"event","subscription":"s","seq":1,"schemaVersion":1,"data":{"text":"$replaced"}}""", FrameSource.DESKTOP)
        assertTrue(event is RemoteEventFrame)
        assertEquals(RemoteErrorCode.MALFORMED, refused("""{"type":"hello$replaced","versions":[1]}""", FrameSource.DESKTOP))
        assertEquals(RemoteErrorCode.MALFORMED, refused("{\"type\":\"hello\",\"versions\":[1]\uD800", FrameSource.DESKTOP))
        read("{\"type\":\"hello\",\"versions\":[1],\"x\":\"\uDC00\"}", FrameSource.DESKTOP)
        assertEquals(RemoteErrorCode.MALFORMED, refused(replaced, FrameSource.DESKTOP))
    }

    @Test
    fun refusesDesktopFramesOfUnknownTypeOrMissingFields() {
        for (type in listOf("teleport", "EVENT", "", "event ")) {
            assertEquals(type, RemoteErrorCode.MALFORMED, refused("""{"type":"$type","subscription":"s","seq":1,"schemaVersion":1,"data":{}}""", FrameSource.DESKTOP))
        }
        for (text in listOf(
            """{"subscription":"s","seq":1,"schemaVersion":1,"data":{}}""",
            """{"type":7}""",
            """{"type":null}""",
            """{"type":"event","seq":1,"schemaVersion":1,"data":{}}""",
            """{"type":"event","subscription":"s","schemaVersion":1,"data":{}}""",
            """{"type":"event","subscription":"s","seq":1,"schemaVersion":1}""",
            """{"type":"snapshot","subscription":"s","seq":1,"schemaVersion":1}""",
            """{"type":"ack"}""",
            """{"type":"error"}""",
            """{"type":"event","subscription":"s","seq":99999999999999999999,"schemaVersion":1,"data":{}}""",
            """{"type":"event","subscription":"s","seq":1.5,"schemaVersion":1,"data":{}}""",
        )) assertEquals(text, RemoteErrorCode.MALFORMED, refused(text, FrameSource.DESKTOP))
    }

    @Test
    fun refusesKnownTypesWhoseFieldsDontFit() {
        assertEquals(RemoteErrorCode.MALFORMED, refused("""{"type":"hello"}"""))
        assertEquals(RemoteErrorCode.MALFORMED, refused("""{"type":"subscribe","id":"1","topic":"secrets"}"""))
        assertEquals(RemoteErrorCode.MALFORMED, refused("""{"type":"event","subscription":"s","seq":"one","schemaVersion":1,"data":{}}""", FrameSource.DESKTOP))
    }

    @Test
    fun readsTheFramesEachSideMaySend() {
        assertEquals(RemoteHelloFrame(versions = listOf(1L)), read("""{"type":"hello","versions":[1]}""", FrameSource.CLIENT))
        val command = read("""{"type":"command","id":"1","command":"thread.interrupt","args":{"threadId":"t"}}""", FrameSource.CLIENT)
        assertEquals(RemoteCommandFrame(id = "1", command = RemoteCommand.THREAD_INTERRUPT, args = buildJsonObject { put("threadId", "t") }), command)
        val event = read("""{"type":"event","subscription":"s","seq":1,"schemaVersion":1,"data":{}}""", FrameSource.DESKTOP)
        assertEquals(1L, (event as RemoteEventFrame).seq)
    }

    @Test
    fun ignoresFieldsAddedByANewerDesktop() {
        val hello = read("""{"type":"hello","versions":[1,2],"desktopName":"Studio","since":"2027"}""", FrameSource.DESKTOP)
        assertEquals(RemoteHelloFrame(versions = listOf(1L, 2L), desktopName = "Studio"), hello)
    }

    @Test
    fun readsAnErrorCodeItDoesntKnowAsInternal() {
        val error = read("""{"type":"error","id":"7","code":"quota-exceeded"}""", FrameSource.DESKTOP)
        assertEquals(RemoteErrorFrame(id = "7", code = RemoteErrorCode.INTERNAL), error)
        assertEquals(RemoteErrorFrame(code = RemoteErrorCode.RATE_LIMITED, retryAfterMs = 500L), read("""{"type":"error","code":"rate-limited","retryAfterMs":500}""", FrameSource.DESKTOP))
    }

    @Test
    fun writesClientFramesWithTheirTypeAndReadsThemBack() {
        val frames = listOf(
            RemoteHelloFrame(versions = listOf(REMOTE_PROTOCOL_VERSION.toLong())),
            RemoteAuthFrame(id = "a", refresh = RemoteAuthFrame.Refresh(deviceId = "d", nonce = "n", signature = "s")),
            RemoteSubscribeFrame(id = "b", topic = RemoteSubscription.TERMINAL, target = "pane-1", sinceSeq = 41L),
            RemoteUnsubscribeFrame(id = "c", subscription = "sub-1"),
            RemoteCommandFrame(id = "d", command = RemoteCommand.THREAD_SEND, args = buildJsonObject { put("text", JsonPrimitive("oi")) })
        )
        for (frame in frames) {
            val text = RemoteFrames.write(frame)
            assertTrue(text, text.contains("\"type\":"))
            assertEquals(frame, read(text, FrameSource.CLIENT))
        }
        assertTrue(RemoteFrames.write(frames[2]).contains(""""topic":"terminal""""))
    }

    @Test(expected = IllegalArgumentException::class)
    fun neverWritesADesktopFrame() {
        RemoteFrames.write(RemoteAckFrame(id = "1"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun neverWritesAnOversizedFrame() {
        RemoteFrames.write(RemoteCommandFrame(id = "1", command = RemoteCommand.THREAD_SEND, args = buildJsonObject { put("text", "x".repeat(RemoteLimits.MAX_FRAME_BYTES)) }))
    }

    @Test
    fun namesEveryEntryAfterItsWireValue() {
        assertEquals(RemoteCommand.THREAD_RESPOND_REQUEST, RemoteCommand.fromWire("thread.respondRequest"))
        assertEquals(RemoteErrorCode.TOO_MANY_SUBSCRIPTIONS, RemoteErrorCode.fromWire("too-many-subscriptions"))
        assertEquals(RemoteSubscription.PENDING_REQUESTS, RemoteSubscription.fromWire("pendingRequests"))
        assertEquals(null, RemoteCommand.fromWire("host.exec"))
    }
}
