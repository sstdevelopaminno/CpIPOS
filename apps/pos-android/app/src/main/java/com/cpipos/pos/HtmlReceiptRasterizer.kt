package com.cpipos.pos

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayOutputStream
import java.io.File
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
        val pdfStarted = AtomicBoolean(false)
        var pdfFile: File? = null
        var renderError: Throwable? = null
        var printCancellation: CancellationSignal? = null
        var webView: WebView? = null

        fun cleanupWebViewOnMain(view: WebView?) {
            runCatching { printCancellation?.cancel() }
            printCancellation = null
            view?.let {
                runCatching { it.stopLoading() }
                runCatching { it.destroy() }
            }
            webView = null
        }

        fun finishWithPdf(view: WebView?, file: File) {
            if (!completed.compareAndSet(false, true)) {
                runCatching { file.delete() }
                return
            }
            pdfFile = file
            cleanupWebViewOnMain(view)
            latch.countDown()
        }

        fun failRenderOnMain(code: String, message: String, cause: Throwable? = null) {
            val view = webView
            if (!completed.compareAndSet(false, true)) return
            renderError = NativePrintException(code, true, message, cause)
            cleanupWebViewOnMain(view)
            latch.countDown()
        }

        fun writePdfOnMain(view: WebView, contentHeightPx: Int) {
            try {
                val adapter = view.createPrintDocumentAdapter("CpIPOS Receipt")
                val attributes = buildPrintAttributes(paperWidthMm, contentHeightPx, renderWidth)
                val cancellation = CancellationSignal()
                printCancellation = cancellation
                val file = File.createTempFile("cpipos-receipt-", ".pdf", appContext.cacheDir)

                adapter.onLayout(
                    null,
                    attributes,
                    cancellation,
                    object : PrintDocumentAdapter.LayoutResultCallback() {
                        override fun onLayoutFinished(info: PrintDocumentInfo?, changed: Boolean) {
                            var output: ParcelFileDescriptor? = null
                            try {
                                output = ParcelFileDescriptor.open(
                                    file,
                                    ParcelFileDescriptor.MODE_READ_WRITE or ParcelFileDescriptor.MODE_TRUNCATE or ParcelFileDescriptor.MODE_CREATE
                                )
                                adapter.onWrite(
                                    arrayOf(PageRange.ALL_PAGES),
                                    output,
                                    cancellation,
                                    object : PrintDocumentAdapter.WriteResultCallback() {
                                        override fun onWriteFinished(pages: Array<out PageRange>?) {
                                            runCatching { output?.close() }
                                            if (file.length() <= 0L) {
                                                runCatching { file.delete() }
                                                failRenderOnMain("receipt_html_pdf_empty", "HTML receipt PDF was empty")
                                                return
                                            }
                                            finishWithPdf(view, file)
                                        }

                                        override fun onWriteFailed(error: CharSequence?) {
                                            runCatching { output?.close() }
                                            runCatching { file.delete() }
                                            failRenderOnMain("receipt_html_pdf_write_failed", error?.toString() ?: "HTML receipt PDF write failed")
                                        }

                                        override fun onWriteCancelled() {
                                            runCatching { output?.close() }
                                            runCatching { file.delete() }
                                            failRenderOnMain("receipt_html_pdf_cancelled", "HTML receipt PDF write was cancelled")
                                        }
                                    }
                                )
                            } catch (error: Throwable) {
                                runCatching { output?.close() }
                                runCatching { file.delete() }
                                failRenderOnMain("receipt_html_pdf_write_failed", error.message ?: "HTML receipt PDF write failed", error)
                            }
                        }

                        override fun onLayoutFailed(error: CharSequence?) {
                            runCatching { file.delete() }
                            failRenderOnMain("receipt_html_pdf_layout_failed", error?.toString() ?: "HTML receipt PDF layout failed")
                        }

                        override fun onLayoutCancelled() {
                            runCatching { file.delete() }
                            failRenderOnMain("receipt_html_pdf_cancelled", "HTML receipt PDF layout was cancelled")
                        }
                    },
                    null
                )
            } catch (error: Throwable) {
                failRenderOnMain("receipt_html_pdf_failed", error.message ?: "HTML receipt PDF generation failed", error)
            }
        }

        fun preparePdfOnMain(deadlineMs: Long) {
            val view = webView ?: return
            try {
                val widthSpec = View.MeasureSpec.makeMeasureSpec(renderWidth, View.MeasureSpec.EXACTLY)
                view.measure(widthSpec, View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
                val measuredContentHeight = usableRenderHeight(view.measuredHeight, view.contentHeight, view.scale)
                if (measuredContentHeight <= MIN_USABLE_RENDER_HEIGHT_PX) {
                    if (SystemClock.uptimeMillis() < deadlineMs) {
                        mainHandler.postDelayed({ preparePdfOnMain(deadlineMs) }, HEIGHT_POLL_INTERVAL_MS)
                    } else {
                        failRenderOnMain("receipt_html_render_empty_height", "HTML receipt content height did not become usable")
                    }
                    return
                }

                val contentHeight = measuredContentHeight.coerceAtMost(MAX_RENDER_HEIGHT_PX)
                view.layout(0, 0, renderWidth, contentHeight)
                if (!pdfStarted.compareAndSet(false, true)) return
                writePdfOnMain(view, contentHeight)
            } catch (error: Throwable) {
                failRenderOnMain("receipt_html_render_failed", error.message ?: "HTML receipt rendering failed", error)
            }
        }

        mainHandler.post {
            try {
                val view = WebView(appContext)
                webView = view
                view.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
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
                        mainHandler.postDelayed({ preparePdfOnMain(renderDeadlineMs()) }, PAGE_SETTLE_DELAY_MS)
                    }
                }

                view.loadDataWithBaseURL(
                    BuildConfig.CPIPOS_API_BASE_URL,
                    normalizeHtmlForRaster(html),
                    "text/html",
                    "UTF-8",
                    null
                )

                mainHandler.postDelayed({ preparePdfOnMain(renderDeadlineMs()) }, FALLBACK_RENDER_DELAY_MS)
            } catch (error: Throwable) {
                if (completed.compareAndSet(false, true)) {
                    renderError = error
                    cleanupWebViewOnMain(webView)
                    latch.countDown()
                }
            }
        }

        if (!latch.await(RENDER_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            if (completed.compareAndSet(false, true)) {
                mainHandler.post { cleanupWebViewOnMain(webView) }
            }
            throw NativePrintException("receipt_html_render_timeout", true, "HTML receipt rendering timed out")
        }
        renderError?.let { error ->
            if (error is NativePrintException) throw error
            throw NativePrintException("receipt_html_render_failed", true, error.message ?: "HTML receipt rendering failed", error)
        }
        val sourcePdf = pdfFile ?: throw NativePrintException("receipt_html_pdf_missing", true, "HTML receipt PDF was not created")

        val source = try {
            renderPdfToBitmap(sourcePdf, targetDots)
        } finally {
            runCatching { sourcePdf.delete() }
        }

        return try {
            val cropped = cropWhiteMargins(source)
            if (!hasMeaningfulDarkPixels(cropped)) {
                throw NativePrintException("receipt_html_render_blank", true, "HTML receipt rendered a blank bitmap")
            }
            val scaledHeight = max(1, (cropped.height.toDouble() * targetDots / cropped.width).roundToInt())
            val scaled = if (cropped.width == targetDots) cropped else Bitmap.createScaledBitmap(cropped, targetDots, scaledHeight, true)
            try {
                bitmapToEscPosRaster(scaled).also { bytes ->
                    if (isRasterOutputTooSmallForTest(bytes.size)) {
                        throw NativePrintException("receipt_html_render_blank", true, "HTML receipt raster output was too small")
                    }
                }
            } finally {
                if (scaled !== cropped) scaled.recycle()
                if (cropped !== source) cropped.recycle()
            }
        } finally {
            source.recycle()
        }
    }

    private fun renderDeadlineMs() = SystemClock.uptimeMillis() + HEIGHT_POLL_TIMEOUT_MS

    private fun usableRenderHeight(measuredHeight: Int, contentHeight: Int, scale: Float): Int {
        return usableRenderHeightForTest(measuredHeight, contentHeight, scale).coerceAtMost(MAX_RENDER_HEIGHT_PX)
    }

    private fun buildPrintAttributes(paperWidthMm: Int, contentHeightPx: Int, renderWidthPx: Int): PrintAttributes {
        val widthMm = if (paperWidthMm <= 58) 58 else 80
        val widthMils = mmToMils(widthMm.toDouble())
        val heightMils = receiptMediaHeightMilsForTest(contentHeightPx, renderWidthPx, widthMm)
        return PrintAttributes.Builder()
            .setMediaSize(PrintAttributes.MediaSize("CPIPOS_RECEIPT_${widthMm}", "CpIPOS ${widthMm}mm Receipt", widthMils, heightMils))
            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
            .setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME)
            .setResolution(PrintAttributes.Resolution("CPIPOS_RECEIPT_RASTER", "CpIPOS Receipt Raster", PDF_RENDER_DPI, PDF_RENDER_DPI))
            .build()
    }

    private fun renderPdfToBitmap(pdfFile: File, targetWidthPx: Int): Bitmap {
        var descriptor: ParcelFileDescriptor? = null
        var renderer: PdfRenderer? = null
        val pageBitmaps = mutableListOf<Bitmap>()
        try {
            descriptor = ParcelFileDescriptor.open(pdfFile, ParcelFileDescriptor.MODE_READ_ONLY)
            renderer = PdfRenderer(descriptor)
            if (!hasUsablePdfPagesForTest(renderer.pageCount)) {
                throw NativePrintException("receipt_html_pdf_no_pages", true, "HTML receipt PDF had no pages")
            }

            for (index in 0 until renderer.pageCount) {
                val page = renderer.openPage(index)
                try {
                    val pageHeight = pageBitmapHeightForTest(page.width, page.height, targetWidthPx)
                    val currentTotal = pageBitmaps.sumOf { it.height }
                    if (currentTotal + pageHeight > MAX_RENDER_HEIGHT_PX) {
                        throw NativePrintException("receipt_html_pdf_too_tall", true, "HTML receipt PDF was too tall to rasterize")
                    }
                    val bitmap = Bitmap.createBitmap(targetWidthPx, pageHeight, Bitmap.Config.ARGB_8888)
                    bitmap.eraseColor(Color.WHITE)
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
                    pageBitmaps += bitmap
                } finally {
                    page.close()
                }
            }

            val totalHeight = concatenatedHeightForTest(pageBitmaps.map { it.height })
            if (totalHeight <= 0) throw NativePrintException("receipt_html_pdf_no_pages", true, "HTML receipt PDF had no usable page content")
            return Bitmap.createBitmap(targetWidthPx, totalHeight, Bitmap.Config.ARGB_8888).also { output ->
                val canvas = Canvas(output)
                canvas.drawColor(Color.WHITE)
                var offsetY = 0f
                for (bitmap in pageBitmaps) {
                    canvas.drawBitmap(bitmap, 0f, offsetY, null)
                    offsetY += bitmap.height
                }
            }
        } catch (error: NativePrintException) {
            throw error
        } catch (error: Throwable) {
            throw NativePrintException("receipt_html_pdf_render_failed", true, error.message ?: "HTML receipt PDF render failed", error)
        } finally {
            pageBitmaps.forEach { it.recycle() }
            runCatching { renderer?.close() }
            runCatching { descriptor?.close() }
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

    private fun hasMeaningfulDarkPixels(bitmap: Bitmap): Boolean {
        var darkPixels = 0
        val step = if (bitmap.width > 600) 2 else 1
        var y = 0
        while (y < bitmap.height) {
            var x = 0
            while (x < bitmap.width) {
                val pixel = bitmap.getPixel(x, y)
                if (isMeaningfullyDarkForTest(Color.red(pixel), Color.green(pixel), Color.blue(pixel))) {
                    darkPixels += 1
                    if (darkPixels >= MIN_DARK_PIXELS) return true
                }
                x += step
            }
            y += step
        }
        return false
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

    internal companion object {
        const val PAGE_SETTLE_DELAY_MS = 120L
        const val FALLBACK_RENDER_DELAY_MS = 900L
        const val RENDER_TIMEOUT_SECONDS = 8L
        const val MAX_RENDER_HEIGHT_PX = 16_000
        const val HEIGHT_POLL_INTERVAL_MS = 80L
        const val HEIGHT_POLL_TIMEOUT_MS = 3_500L
        const val MIN_USABLE_RENDER_HEIGHT_PX = 1
        const val MIN_DARK_PIXELS = 8
        const val MIN_VALID_RASTER_BYTES = 59
        const val PDF_RENDER_DPI = 203
        const val MAX_RECEIPT_MEDIA_HEIGHT_MILS = 48_000
        const val MIN_RECEIPT_MEDIA_HEIGHT_MILS = 4_000

        fun usableRenderHeightForTest(measuredHeight: Int, contentHeight: Int, scale: Float): Int {
            return max(measuredHeight, (contentHeight * scale).roundToInt())
        }

        fun mmToMils(mm: Double): Int {
            return (mm / 25.4 * 1000.0).roundToInt().coerceAtLeast(1)
        }

        fun receiptMediaHeightMilsForTest(contentHeightPx: Int, renderWidthPx: Int, paperWidthMm: Int): Int {
            if (contentHeightPx <= 0 || renderWidthPx <= 0) return MIN_RECEIPT_MEDIA_HEIGHT_MILS
            val heightMm = paperWidthMm.toDouble() * contentHeightPx.toDouble() / renderWidthPx.toDouble()
            return mmToMils(heightMm).coerceIn(MIN_RECEIPT_MEDIA_HEIGHT_MILS, MAX_RECEIPT_MEDIA_HEIGHT_MILS)
        }

        fun pageBitmapHeightForTest(pageWidth: Int, pageHeight: Int, targetWidth: Int): Int {
            if (pageWidth <= 0 || pageHeight <= 0 || targetWidth <= 0) return 0
            return max(1, (pageHeight.toDouble() * targetWidth.toDouble() / pageWidth.toDouble()).roundToInt())
                .coerceAtMost(MAX_RENDER_HEIGHT_PX)
        }

        fun concatenatedHeightForTest(pageHeights: List<Int>): Int {
            if (pageHeights.isEmpty() || pageHeights.any { it <= 0 }) return 0
            val total = pageHeights.sum()
            return if (total > MAX_RENDER_HEIGHT_PX) 0 else total
        }

        fun hasUsablePdfPagesForTest(pageCount: Int): Boolean {
            return pageCount > 0
        }

        fun isMeaningfullyDarkForTest(red: Int, green: Int, blue: Int): Boolean {
            val luminance = (red * 299 + green * 587 + blue * 114) / 1000
            return luminance < 220
        }

        fun isRasterOutputTooSmallForTest(byteCount: Int): Boolean {
            return byteCount <= MIN_VALID_RASTER_BYTES
        }

        fun escPosRasterSizeForTest(widthPixels: Int, heightPixels: Int): Int {
            val widthBytes = (widthPixels + 7) / 8
            val stripCount = max(1, (heightPixels + 191) / 192)
            return stripCount * 8 + widthBytes * heightPixels + 3
        }
    }
}
