package com.oxespace.mobile.pairing

import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.NotFoundException
import com.google.zxing.ReaderException
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader

/** QR codes only, from the luminance plane of a camera frame. On the device; no image leaves the phone. */
object QrDecoder {
    private val hints = mapOf(
        DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
        DecodeHintType.CHARACTER_SET to "UTF-8",
    )

    /** The text of the QR code in the frame, or null when there is none (the usual case). */
    fun decode(luminance: ByteArray, rowStride: Int, width: Int, height: Int): String? {
        val source = PlanarYUVLuminanceSource(luminance, rowStride, height, 0, 0, width, height, false)
        return try {
            QRCodeReader().decode(BinaryBitmap(HybridBinarizer(source)), hints).text
        } catch (_: NotFoundException) {
            null
        } catch (_: ReaderException) {
            null
        }
    }
}

/** Feeds each camera frame to [QrDecoder] and reports what it reads. */
class QrAnalyzer(private val onText: (String) -> Unit) : ImageAnalysis.Analyzer {
    override fun analyze(image: ImageProxy) {
        image.use {
            val plane = it.planes[0]
            val buffer = plane.buffer
            val bytes = ByteArray(buffer.remaining()).also(buffer::get)
            QrDecoder.decode(bytes, plane.rowStride, it.width, it.height)?.let(onText)
        }
    }
}
