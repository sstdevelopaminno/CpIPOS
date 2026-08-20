package com.cpipos.pos

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import java.io.ByteArrayOutputStream
import kotlin.math.ceil

/**
 * Fast native raster path for server-formatted POS text payloads.
 *
 * The server already formats receipts/tickets to the target character width. Rendering those
 * lines with Android Canvas keeps Thai shaping on-device without starting an off-screen WebView
 * for every print job. HTML rasterization remains the compatibility fallback.
 *
 * CpIPOS 1.0.19 deliberately advances about 10 cm of blank paper after the final printed line.
 * This keeps the last receipt/kitchen line above the tear bar instead of being clipped when the
 * operator tears the paper. The advance uses line-feed control bytes rather than rasterizing a
 * large white bitmap, so it adds virtually no rendering or transport latency.
 */
internal class NativeTextRasterizer {
    fun render(text: String, paperWidthMm: Int): ByteArray {
        val normalized = text.replace("\r\n", "\n").trimEnd('\n', '\r')
        if (normalized.isBlank()) {
            throw NativePrintException("native_text_empty", false, "Native text payload is empty")
        }

        val targetWidth = if (paperWidthMm <= 58) 384 else 576
        val expectedColumns = if (paperWidthMm <= 58) 32 else 42
        val horizontalPadding = if (paperWidthMm <= 58) 8f else 12f
        val verticalPadding = 10f
        val lines = normalized.split('\n')

        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
            color = Color.BLACK
            typeface = Typeface.MONOSPACE
            textSize = if (paperWidthMm <= 58) 20f else 22f
        }

        val usableWidth = targetWidth - horizontalPadding * 2f
        val reference = "0".repeat(expectedColumns)
        val referenceWidth = paint.measureText(reference).coerceAtLeast(1f)
        if (referenceWidth > usableWidth) {
            paint.textSize = (paint.textSize * usableWidth / referenceWidth).coerceAtLeast(14f)
        }

        val widestLine = lines.maxByOrNull { it.length }.orEmpty()
        val widestWidth = paint.measureText(widestLine).coerceAtLeast(1f)
        if (widestWidth > usableWidth) {
            paint.textSize = (paint.textSize * usableWidth / widestWidth).coerceAtLeast(13f)
        }

        val metrics = paint.fontMetrics
        val lineHeight = ceil((metrics.descent - metrics.ascent) + if (paperWidthMm <= 58) 4f else 5f).toInt().coerceAtLeast(18)
        val bitmapHeight = (verticalPadding * 2f).toInt() + lineHeight * lines.size
        if (bitmapHeight <= 0 || bitmapHeight > MAX_TEXT_RASTER_HEIGHT) {
            throw NativePrintException("native_text_too_tall", true, "Native text receipt is too tall")
        }

        val bitmap = Bitmap.createBitmap(targetWidth, bitmapHeight, Bitmap.Config.ARGB_8888)
        return try {
            bitmap.eraseColor(Color.WHITE)
            val canvas = Canvas(bitmap)
            var baseline = verticalPadding - metrics.ascent
            for (line in lines) {
                canvas.drawText(line, horizontalPadding, baseline, paint)
                baseline += lineHeight
            }
            bitmapToEscPosRaster(bitmap)
        } finally {
            bitmap.recycle()
        }
    }

    private fun bitmapToEscPosRaster(bitmap: Bitmap): ByteArray {
        val widthBytes = (bitmap.width + 7) / 8
        val output = ByteArrayOutputStream()
        val stripHeight = 192
        var startY = 0
        while (startY < bitmap.height) {
            val rows = minOf(stripHeight, bitmap.height - startY)
            output.write(
                byteArrayOf(
                    0x1D, 0x76, 0x30, 0x00,
                    (widthBytes and 0xFF).toByte(),
                    ((widthBytes shr 8) and 0xFF).toByte(),
                    (rows and 0xFF).toByte(),
                    ((rows shr 8) and 0xFF).toByte()
                )
            )
            val pixels = IntArray(bitmap.width * rows)
            bitmap.getPixels(pixels, 0, bitmap.width, 0, startY, bitmap.width, rows)
            for (row in 0 until rows) {
                val rowOffset = row * bitmap.width
                for (byteIndex in 0 until widthBytes) {
                    var packed = 0
                    for (bit in 0..7) {
                        val x = byteIndex * 8 + bit
                        if (x >= bitmap.width) continue
                        val pixel = pixels[rowOffset + x]
                        val luminance = (Color.red(pixel) * 299 + Color.green(pixel) * 587 + Color.blue(pixel) * 114) / 1000
                        if (luminance < 180) packed = packed or (1 shl (7 - bit))
                    }
                    output.write(packed)
                }
            }
            startY += rows
        }

        // Standard ESC/POS line spacing is approximately 1/6 inch. 24 feeds advance about
        // 101.6 mm. Keeping this as control bytes avoids adding a large all-white raster tail.
        repeat(TAIL_FEED_LINES) { output.write('\n'.code) }
        return output.toByteArray()
    }

    companion object {
        private const val MAX_TEXT_RASTER_HEIGHT = 12_000
        internal const val TAIL_FEED_LINES = 24
        internal const val APPROX_TAIL_FEED_MM = 102
    }
}
