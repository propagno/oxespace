package com.oxespace.mobile.ui.theme

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * OXE-149 (CA-6): the phone type scale and radii against the approved brand target, BRD-07 in
 * src/design/targets/brd-07.json. Every measure is checked and reported; only an `enforced` one fails, the same rule
 * as the desktop run (e2e/brand/brand-conformance.spec.ts). A measure turns enforced in the PR that delivers BRD-07.
 */
class BrandScaleTest {
    private val repo: File = generateSequence(File(".").absoluteFile) { it.parentFile }
        .first { File(it, "src/design/targets/brd-07.json").isFile }
    private val main = File(repo, "mobile/android/app/src/main/java")

    private val typography = mapOf(
        "Typography.titleMedium" to OxeTypography.titleMedium,
        "Typography.bodyMedium" to OxeTypography.bodyMedium,
        "Typography.labelMedium" to OxeTypography.labelMedium,
        "Typography.labelSmall" to OxeTypography.labelSmall,
    )

    private fun sources(): Sequence<File> = main.walkTopDown().filter { it.isFile && it.extension == "kt" && it.name != "OxeTokens.kt" }

    /** Every `N.sp` literal written in the app's sources, outside the generated tokens. */
    private fun spLiterals(): List<Pair<String, Float>> = sources().flatMap { file ->
        Regex("""(?<![\w.])(\d+(?:\.\d+)?)\.sp\b""").findAll(file.readText()).map { "${file.name} ${it.value}" to it.groupValues[1].toFloat() }
    }.toList()

    /** Corner shapes written with a literal dp instead of an OxeRadius token. */
    private fun literalRadii(): List<String> = sources().flatMap { file ->
        Regex("""RoundedCornerShape\(\s*\d+(?:\.\d+)?\.dp""").findAll(file.readText()).map { "${file.name} ${it.value}" }
    }.toList()

    private fun measure(entry: JsonObject): Pair<Boolean, String> {
        val select = entry.getValue("select").jsonPrimitive.content
        val prop = entry.getValue("prop").jsonPrimitive.content
        val expect = entry.getValue("expect").jsonObject
        return when (prop) {
            "font-size" -> {
                val actual = typography.getValue(select).fontSize.value
                val wanted = expect.getValue("sp").jsonPrimitive.content.toFloat()
                (actual == wanted) to "${actual}sp"
            }
            "font-weight" -> {
                val actual = typography.getValue(select).fontWeight?.weight
                val wanted = expect.getValue("eq").jsonPrimitive.content.toInt()
                (actual == wanted) to "$actual"
            }
            "min-font-size" -> {
                val floor = expect.getValue("gte").jsonPrimitive.content.toFloat()
                val below = spLiterals().filter { it.second < floor }
                below.isEmpty() to (below.joinToString { it.first }.ifEmpty { "none below ${floor}sp" })
            }
            "radius" -> {
                val literal = literalRadii()
                literal.isEmpty() to (literal.joinToString().ifEmpty { "only OxeRadius" })
            }
            else -> false to "unknown prop $prop"
        }
    }

    @Test
    fun brd07ScaleAndRadiiMatchTheTarget() {
        val doc = Json.parseToJsonElement(File(repo, "src/design/targets/brd-07.json").readText()).jsonObject
        val failures = mutableListOf<String>()
        for (element in doc.getValue("measures").jsonArray) {
            val entry = element.jsonObject
            val id = entry.getValue("id").jsonPrimitive.content
            val state = entry.getValue("state").jsonPrimitive.content
            val (ok, measured) = measure(entry)
            println("[BRAND] ${if (ok) "ok  " else "OFF "} ${state.padEnd(8)} $id expected ${entry.getValue("expect")} measured $measured")
            if (!ok && state == "enforced") failures += "$id: $measured"
        }
        assertTrue("enforced BRD-07 measures off target: $failures", failures.isEmpty())
    }
}
