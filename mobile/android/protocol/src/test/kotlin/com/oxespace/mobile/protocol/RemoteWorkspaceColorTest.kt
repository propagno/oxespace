package com.oxespace.mobile.protocol

import kotlinx.serialization.Serializable
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.0 A67 (OXE program, phase F10). Written by the planner; the executor must not edit it.
 * CCR: docs/roadmap-1.5/ccr-a67-workspace-color.md (#693). `RemoteWorkspace.color` comes from `npm run android:generate`.
 */
class RemoteWorkspaceColorTest {
    private val pane = """{"id":"p1","title":"Build","kind":"terminal","phoneWrite":false}"""
    private val withColor = """{"workspaces":[{"id":"ws1","name":"proj","active":true,"panes":[$pane],"color":4}]}"""
    private val withoutColor = """{"workspaces":[{"id":"ws1","name":"proj","active":true,"panes":[$pane]}]}"""

    @Test
    fun aWorkspaceWithAColourDecodesIt() {
        val decoded = RemoteFrames.json.decodeFromString(RemoteWorkspacesData.serializer(), withColor)
        assertEquals(4, decoded.workspaces.single().color)
    }

    @Test
    fun anOlderDesktopWithoutTheFieldDecodesToNull() {
        val decoded = RemoteFrames.json.decodeFromString(RemoteWorkspacesData.serializer(), withoutColor)
        assertNull(decoded.workspaces.single().color)
    }

    /** The v1.4.3 shape, held here: what an APK shipped before A67 decodes a workspace into. */
    @Serializable
    private data class Workspace143(val id: String, val name: String, val active: Boolean, val panes: List<RemotePane>)

    @Serializable
    private data class Workspaces143(val workspaces: List<Workspace143>)

    @Test
    fun anApkWithoutTheFieldStillReadsThisDesktop() {
        // RemoteFrames.json is configured as on tag v1.4.3: ignoreUnknownKeys, explicitNulls off.
        val newer = withColor.replace("\"color\":4", "\"color\":4,\"notYetKnown\":{\"x\":1}")
        val fromNewer = RemoteFrames.json.decodeFromString(Workspaces143.serializer(), newer)
        val fromOlder = RemoteFrames.json.decodeFromString(Workspaces143.serializer(), withoutColor)
        assertEquals(fromOlder, fromNewer)
        assertEquals("proj", fromNewer.workspaces.single().name)
    }
}
