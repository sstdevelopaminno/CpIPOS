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
