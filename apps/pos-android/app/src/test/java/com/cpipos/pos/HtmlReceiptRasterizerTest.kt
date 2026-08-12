package com.cpipos.pos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HtmlReceiptRasterizerTest {
    @Test
    fun zeroOrOnePixelHeightIsNotUsable() {
        assertEquals(0, HtmlReceiptRasterizer.usableRenderHeightForTest(0, 0, 1f))
        assertEquals(1, HtmlReceiptRasterizer.usableRenderHeightForTest(1, 0, 1f))
        assertTrue(HtmlReceiptRasterizer.usableRenderHeightForTest(0, 24, 1f) > HtmlReceiptRasterizer.MIN_USABLE_RENDER_HEIGHT_PX)
    }

    @Test
    fun pdfPageBitmapSizingScalesToTargetWidth() {
        assertEquals(384, HtmlReceiptRasterizer.pageBitmapHeightForTest(768, 768, 384))
        assertEquals(768, HtmlReceiptRasterizer.pageBitmapHeightForTest(384, 768, 384))
        assertEquals(0, HtmlReceiptRasterizer.pageBitmapHeightForTest(0, 768, 384))
        assertEquals(0, HtmlReceiptRasterizer.pageBitmapHeightForTest(384, 0, 384))
    }

    @Test
    fun pageConcatenationRejectsEmptyInvalidOrTooTallPages() {
        assertEquals(0, HtmlReceiptRasterizer.concatenatedHeightForTest(emptyList()))
        assertEquals(0, HtmlReceiptRasterizer.concatenatedHeightForTest(listOf(240, 0)))
        assertEquals(320, HtmlReceiptRasterizer.concatenatedHeightForTest(listOf(120, 200)))
        assertEquals(
            0,
            HtmlReceiptRasterizer.concatenatedHeightForTest(
                listOf(HtmlReceiptRasterizer.MAX_RENDER_HEIGHT_PX, 1)
            )
        )
    }

    @Test
    fun emptyPdfPageCountIsRejected() {
        assertFalse(HtmlReceiptRasterizer.hasUsablePdfPagesForTest(0))
        assertFalse(HtmlReceiptRasterizer.hasUsablePdfPagesForTest(-1))
        assertTrue(HtmlReceiptRasterizer.hasUsablePdfPagesForTest(1))
    }

    @Test
    fun receiptMediaHeightIsBounded() {
        assertEquals(
            HtmlReceiptRasterizer.MIN_RECEIPT_MEDIA_HEIGHT_MILS,
            HtmlReceiptRasterizer.receiptMediaHeightMilsForTest(0, 768, 58)
        )
        assertEquals(
            HtmlReceiptRasterizer.MAX_RECEIPT_MEDIA_HEIGHT_MILS,
            HtmlReceiptRasterizer.receiptMediaHeightMilsForTest(200_000, 768, 58)
        )
    }

    @Test
    fun blankPixelsAreNotMeaningfulContent() {
        assertFalse(HtmlReceiptRasterizer.isMeaningfullyDarkForTest(255, 255, 255))
        assertFalse(HtmlReceiptRasterizer.isMeaningfullyDarkForTest(248, 248, 248))
        assertTrue(HtmlReceiptRasterizer.isMeaningfullyDarkForTest(0, 0, 0))
    }

    @Test
    fun oneRowRasterIsRejectedAndValidRasterIsSubstantial() {
        val oneRowBytes = HtmlReceiptRasterizer.escPosRasterSizeForTest(widthPixels = 384, heightPixels = 1)
        val validBytes = HtmlReceiptRasterizer.escPosRasterSizeForTest(widthPixels = 384, heightPixels = 64)

        assertEquals(59, oneRowBytes)
        assertTrue(HtmlReceiptRasterizer.isRasterOutputTooSmallForTest(oneRowBytes))
        assertFalse(HtmlReceiptRasterizer.isRasterOutputTooSmallForTest(validBytes))
        assertTrue(validBytes > 59)
    }
}
