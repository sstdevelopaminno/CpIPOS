package com.cpipos.pos

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Renders the same HTML receipt used by the POS receipt screen with Android's
 * font engine, then converts it to ESC/POS raster bytes. This avoids relying on
 * printer firmware Thai code pages and keeps LAN/USB/Bluetooth output identical.
 */
internal class HtmlReceiptRasterizer(context: Context) {
    private val appContext = context.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())

    fun render(html: String, paperWidthMm: Int): ByteArray {
        if (html.isBlank()) throw NativePrintException("receipt_html_empty", false, "Receipt HTML is empty")
        val targetDots = if (paperWidthMm <= 58) 384 else 576
        val renderWidth = targetDots * 2
        val latch = CountDownLatch(1)
        val completed = AtomicBoolean(false)
        var rendered: Bitmap? = null
        var renderError: Throwable? = null
        var webView: WebView? = null

        fun finishRenderOnMain() {
            val view = webView ?: return
            if (!completed.compareAndSet(false, true)) return
            try {
                val widthSpec = View.MeasureSpec.makeMeasureSpec(renderWidth, View.MeasureSpec.EXACTLY)
                view.measure(widthSpec, View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
                val contentHeight = max(
                    view.measuredHeight,
                    (view.contentHeight * view.scale).roundToInt()
                ).coerceIn(1, MAX_RENDER_HEIGHT_PX)
                view.layout(0, 0, renderWidth, contentHeight)
                rendered = Bitmap.createBitmap(renderWidth, contentHeight, Bitmap.Config.ARGB_8888).also { bitmap ->
                    val canvas = Canvas(bitmap)
                    canvas.drawColor(Color.WHITE)
                    view.draw(canvas)
                }
            } catch (error: Throwable) {
                renderError = error
            } finally {
                runCatching { view.stopLoading() }
                runCatching { view.destroy() }
                webView = null
                latch.countDown()
            }
        }

        mainHandler.post {
            try {
                val view = WebView(appContext)
                webView = view
                view.setBackgroundColor(Color.WHITE)
                view.settings.javaScriptEnabled = false
                view.settings.loadsImagesAutomatically = true
                view.settings.blockNetworkImage = false
                view.settings.allowFileAccess = false
                view.settings.allowContentAccess = false
                view.isVerticalScrollBarEnabled = false
                view.isHorizontalScrollBarEnabled = false
                view.webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView, url: String?) {
                        // This WebView is intentionally never attached to a window. Using
                        // View.postDelayed() here can leave the Runnable queued forever on
                        // some POS firmware. Always schedule through the main Looper instead.
                        mainHandler.postDelayed({ finishRenderOnMain() }, PAGE_SETTLE_DELAY_MS)
                    }
                }

                view.loadDataWithBaseURL(
                    BuildConfig.CPIPOS_API_BASE_URL,
                    normalizeHtmlForRaster(html),
                    "text/html",
                    "UTF-8",
                    null
                )

                // Some embedded Android WebView builds do not reliably dispatch
                // onPageFinished() for an unattached, off-screen WebView. The fallback
                // keeps receipt printing deterministic while still giving HTML/fonts and
                // data-URI images enough time to lay out.
                mainHandler.postDelayed({ finishRenderOnMain() }, FALLBACK_RENDER_DELAY_MS)
            } catch (error: Throwable) {
                if (completed.compareAndSet(false, true)) {
                    renderError = error
                    webView?.let { view ->
                        runCatching { view.stopLoading() }
                        runCatching { view.destroy() }
                    }
                    webView = null
                    latch.countDown()
                }
            }
        }

        if (!latch.await(RENDER_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            if (completed.compareAndSet(false, true)) {
                mainHandler.post {
                    webView?.let { view ->
                        runCatching { view.stopLoading() }
                        runCatching { view.destroy() }
                    }
                    webView = null
                }
            }
            throw NativePrintException("receipt_html_render_timeout", true, "HTML receipt rendering timed out")
        }
        renderError?.let { error ->
            throw NativePrintException("receipt_html_render_failed", true, error.message ?: "HTML receipt rendering failed", error)
        }
        val source = rendered ?: throw NativePrintException("receipt_html_render_failed", true, "HTML receipt bitmap was not created")

        return try {
            val cropped = cropWhiteMargins(source)
            val scaledHeight = max(1, (cropped.height.toDouble() * targetDots / cropped.width).roundToInt())
            val scaled = if (cropped.width == targetDots) cropped else Bitmap.createScaledBitmap(cropped, targetDots, scaledHeight, true)
            try {
                bitmapToEscPosRaster(scaled)
            } finally {
                if (scaled !== cropped) scaled.recycle()
                if (cropped !== source) cropped.recycle()
            }
        } finally {
            source.recycle()
        }
    }

    private fun normalizeHtmlForRaster(html: String): String {
        val override = """
            <style id="cpipos-native-raster">
              html,body{margin:0!important;padding:0!important;width:100%!important;min-height:0!important;background:#fff!important;color:#000!important;overflow:visible!important}
              .receipt58,.receipt{width:calc(100% - 28px)!important;margin:0 auto!important;min-height:0!important}
              img{max-width:72%!important;height:auto!important}
            </style>
        """.trimIndent()
        return if (html.contains("</head>", ignoreCase = true)) {
            html.replaceFirst(Regex("</head>", RegexOption.IGNORE_CASE), "$override</head>")
        } else {
            "<html><head><meta charset=\"utf-8\">$override</head><body>$html</body></html>"
        }
    }

    private fun cropWhiteMargins(source: Bitmap): Bitmap {
        var left = source.width
        var top = source.height
        var right = -1
        var bottom = -1
        val step = if (source.width > 600) 2 else 1
        var y = 0
        while (y < source.height) {
            var x = 0
            while (x < source.width) {
                val pixel = source.getPixel(x, y)
                val r = Color.red(pixel)
                val g = Color.green(pixel)
                val b = Color.blue(pixel)
                if (r < 248 || g < 248 || b < 248) {
                    if (x < left) left = x
                    if (x > right) right = x
                    if (y < top) top = y
                    if (y > bottom) bottom = y
                }
                x += step
            }
            y += step
        }
        if (right < left || bottom < top) return source
        val padding = 10
        val cropLeft = (left - padding).coerceAtLeast(0)
        val cropTop = (top - padding).coerceAtLeast(0)
        val cropRight = (right + padding).coerceAtMost(source.width - 1)
        val cropBottom = (bottom + padding).coerceAtMost(source.height - 1)
        if (cropLeft == 0 && cropTop == 0 && cropRight == source.width - 1 && cropBottom == source.height - 1) return source
        return Bitmap.createBitmap(source, cropLeft, cropTop, cropRight - cropLeft + 1, cropBottom - cropTop + 1)
    }

    private fun bitmapToEscPosRaster(bitmap: Bitmap): ByteArray {
        val widthBytes = (bitmap.width + 7) / 8
        val output = ByteArrayOutputStream()
        val stripHeight = 192
        var startY = 0
        while (startY < bitmap.height) {
            val rows = minOf(stripHeight, bitmap.height - startY)
            output.write(byteArrayOf(
                0x1D, 0x76, 0x30, 0x00,
                (widthBytes and 0xFF).toByte(),
                ((widthBytes shr 8) and 0xFF).toByte(),
                (rows and 0xFF).toByte(),
                ((rows shr 8) and 0xFF).toByte()
            ))
            for (row in 0 until rows) {
                val y = startY + row
                for (byteIndex in 0 until widthBytes) {
                    var packed = 0
                    for (bit in 0..7) {
                        val x = byteIndex * 8 + bit
                        if (x >= bitmap.width) continue
                        val pixel = bitmap.getPixel(x, y)
                        val luminance = (Color.red(pixel) * 299 + Color.green(pixel) * 587 + Color.blue(pixel) * 114) / 1000
                        if (luminance < 185) packed = packed or (1 shl (7 - bit))
                    }
                    output.write(packed)
                }
            }
            startY += rows
        }
        output.write('\n'.code)
        output.write('\n'.code)
        output.write('\n'.code)
        return output.toByteArray()
    }

    private companion object {
        const val PAGE_SETTLE_DELAY_MS = 120L
        const val FALLBACK_RENDER_DELAY_MS = 900L
        const val RENDER_TIMEOUT_SECONDS = 6L
        const val MAX_RENDER_HEIGHT_PX = 16_000
    }
}
