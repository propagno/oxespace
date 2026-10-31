package com.oxespace.mobile

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Test
import org.w3c.dom.Element

/** Pairing keys and tokens must never reach a backup: the app opts out of both backup and device transfer. */
class BackupRulesTest {
    private val androidNs = "http://schemas.android.com/apk/res/android"
    private val domains = setOf("root", "file", "database", "sharedpref", "external")

    private fun parse(path: String): Element {
        val factory = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
        return factory.newDocumentBuilder().parse(File(path)).documentElement
    }

    @Test
    fun backupIsOff() {
        val application = parse("src/main/AndroidManifest.xml").getElementsByTagName("application").item(0) as Element
        assertEquals("false", application.getAttributeNS(androidNs, "allowBackup"))
        assertEquals("@xml/data_extraction_rules", application.getAttributeNS(androidNs, "dataExtractionRules"))
        assertEquals("@xml/backup_rules", application.getAttributeNS(androidNs, "fullBackupContent"))
    }

    @Test
    fun everyDomainIsExcludedFromCloudBackupAndDeviceTransfer() {
        val rules = parse("src/main/res/xml/data_extraction_rules.xml")
        for (section in listOf("cloud-backup", "device-transfer")) {
            assertExcludesEverything(section, rules.getElementsByTagName(section).item(0) as Element)
        }
    }

    @Test
    fun everyDomainIsExcludedBeforeAndroid12() {
        assertExcludesEverything("full-backup-content", parse("src/main/res/xml/backup_rules.xml"))
    }

    private fun assertExcludesEverything(section: String, element: Element) {
        val excludes = element.getElementsByTagName("exclude")
        val excluded = (0 until excludes.length).map { (excludes.item(it) as Element).getAttribute("domain") }.toSet()
        assertEquals(section, domains, excluded)
        assertEquals(section, 0, element.getElementsByTagName("include").length)
    }
}
