package com.oxespace.mobile.pairing

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class QrDecoderTest {
    /** A camera-like luminance plane: the QR in black on white, with padding at the end of each row. */
    private fun frame(text: String, size: Int = 480, padding: Int = 32): Triple<ByteArray, Int, Int> {
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, mapOf(EncodeHintType.CHARACTER_SET to "UTF-8"))
        val stride = size + padding
        val bytes = ByteArray(stride * size) { 0xF0.toByte() }
        for (y in 0 until size) for (x in 0 until size) if (matrix[x, y]) bytes[y * stride + x] = 0x10
        return Triple(bytes, stride, size)
    }

    @Test
    fun readsAPairingCodeFromAFrame() {
        val uri = "oxespace://pair?v=1&host=192.168.0.12&port=7443&fp=${"a".repeat(64)}&code=AbCdEfGhIjKlMnOpQrSt_-&name=Est%C3%BAdio"
        val (bytes, stride, size) = frame(uri)
        assertEquals(uri, QrDecoder.decode(bytes, stride, size, size))
    }

    @Test
    fun findsNothingInAnEmptyFrame() {
        assertNull(QrDecoder.decode(ByteArray(640 * 480) { 0x80.toByte() }, 640, 640, 480))
    }
}
