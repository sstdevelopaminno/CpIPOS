package com.cpipos.pos

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PrinterCapabilityHintsTest {
    @Test
    fun recognizesCommonPrinterNamesWithoutDependingOnPosModel() {
        assertTrue(PrinterCapabilityHints.looksLikePrinterName("XP-58"))
        assertTrue(PrinterCapabilityHints.looksLikePrinterName("Thermal Printer 80mm"))
        assertTrue(PrinterCapabilityHints.looksLikePrinterName("TM-T88VI"))
        assertTrue(PrinterCapabilityHints.looksLikePrinterName("ESC/POS Receipt"))
        assertFalse(PrinterCapabilityHints.looksLikePrinterName("Barcode Scanner"))
        assertFalse(PrinterCapabilityHints.looksLikePrinterName("C20Pro"))
    }

    @Test
    fun recognizesPrinterPlatformHintsWithoutHardCodingOneManufacturer() {
        assertTrue(PrinterCapabilityHints.looksLikePrinterFeature("android.software.print"))
        assertTrue(PrinterCapabilityHints.looksLikePrinterFeature("vendor.thermal.printer"))
        assertTrue(PrinterCapabilityHints.looksLikePrinterFeature("com.landicorp.printer"))
        assertFalse(PrinterCapabilityHints.looksLikePrinterFeature("android.hardware.camera"))
    }
}
