package com.cpipos.pos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PrinterHardwareClassifierTest {
    @Test
    fun usbPrinterClassIsSafeAutobindEvidence() {
        assertTrue(PrinterHardwareClassifier.usbSafeAutobindCandidate(usbPrinterClass = true, printerNameHint = false))
    }

    @Test
    fun knownPrinterNameHintIsSafeAutobindEvidence() {
        assertTrue(PrinterHardwareClassifier.hasPrinterNameHint("GLPrinter80", "printer"))
        assertTrue(PrinterHardwareClassifier.usbSafeAutobindCandidate(usbPrinterClass = false, printerNameHint = true))
    }

    @Test
    fun arbitraryWritableNonPrinterNameIsNotSafeAutobindEvidence() {
        assertFalse(PrinterHardwareClassifier.hasPrinterNameHint("USB 10/100/1000 LAN", "Realtek"))
        assertFalse(PrinterHardwareClassifier.usbSafeAutobindCandidate(usbPrinterClass = false, printerNameHint = false))
    }

    @Test
    fun stableUsbFingerprintUsesRealSerialOnly() {
        val withSerial = PrinterHardwareClassifier.usbFingerprint(1048, 20497, "18E1D0005C21", "/dev/bus/usb/001/012")
        assertEquals("usb:vid0418:pid5011:serial:18e1d0005c21", withSerial.value)
        assertEquals("stable", withSerial.stability)

        val withoutSerial = PrinterHardwareClassifier.usbFingerprint(3034, 33107, null, "/dev/bus/usb/002/004")
        assertEquals("usb:vid0bda:pid8153:path:dev_bus_usb_002_004", withoutSerial.value)
        assertEquals("session_scoped", withoutSerial.stability)
    }

    @Test
    fun bluetoothPrinterHintDoesNotAcceptArbitraryAudioDevice() {
        assertFalse(PrinterHardwareClassifier.bluetoothPrinterHint("GEMAUDIO M200", sppUuidPresent = true))
        assertTrue(PrinterHardwareClassifier.bluetoothPrinterHint("Inner Printer", sppUuidPresent = false))
    }

    @Test
    fun bluetoothFingerprintUsesMacAddressWhenAvailable() {
        val fingerprint = PrinterHardwareClassifier.bluetoothFingerprint("00:01:02:03:0A:0B")
        assertEquals("bluetooth:mac:000102030a0b", fingerprint?.value)
        assertEquals("stable", fingerprint?.stability)
    }
}
