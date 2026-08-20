package com.cpipos.pos

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PrinterSelectionPolicyTest {
    @Test
    fun usbAutoSelectionAcceptsOnlyPrinterEvidence() {
        assertTrue(PrinterSelectionPolicy.usbMayAutoSelect(true, null, null))
        assertTrue(PrinterSelectionPolicy.usbMayAutoSelect(false, "printer", "GLPrinter80"))
        assertTrue(PrinterSelectionPolicy.usbMayAutoSelect(false, null, "Thermal Printer 80mm"))

        assertFalse(PrinterSelectionPolicy.usbMayAutoSelect(false, "Realtek", "USB 10/100/1000 LAN"))
        assertFalse(PrinterSelectionPolicy.usbMayAutoSelect(false, "wch.cn", "UART+SPI+I2C+JTAG"))
        assertFalse(PrinterSelectionPolicy.usbMayAutoSelect(false, "MS", "USB Video"))
    }

    @Test
    fun genericUsbWritableEndpointRequiresExplicitPhysicalSelector() {
        assertFalse(PrinterSelectionPolicy.usbMayUseGenericWritableEndpoint(false))
        assertTrue(PrinterSelectionPolicy.usbMayUseGenericWritableEndpoint(true))
    }

    @Test
    fun bluetoothAutoSelectionRejectsUnrelatedBondedDevices() {
        assertTrue(PrinterSelectionPolicy.bluetoothMayAutoSelect("Inner Printer"))
        assertTrue(PrinterSelectionPolicy.bluetoothMayAutoSelect("XP-58"))
        assertFalse(PrinterSelectionPolicy.bluetoothMayAutoSelect("GEMAUDIO M200"))
        assertFalse(PrinterSelectionPolicy.bluetoothMayAutoSelect("Barcode Scanner"))
    }
}
