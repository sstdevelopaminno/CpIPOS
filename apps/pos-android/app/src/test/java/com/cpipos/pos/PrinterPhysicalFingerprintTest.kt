package com.cpipos.pos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PrinterPhysicalFingerprintTest {
    @Test
    fun usbSerialFingerprintIsStableAcrossDevicePathChanges() {
        val first = PrinterPhysicalFingerprint.usb(
            vendorId = 1048,
            productId = 20497,
            serialNumber = "18E1D0005C21",
            deviceName = "/dev/bus/usb/001/012"
        )
        val second = PrinterPhysicalFingerprint.usb(
            vendorId = 1048,
            productId = 20497,
            serialNumber = "18e1d0005c21",
            deviceName = "/dev/bus/usb/002/004"
        )

        assertEquals(first, second)
        assertEquals("usb:vid0418:pid5011:serial:18e1d0005c21", first?.value)
        assertEquals(PrinterPhysicalFingerprint.Stability.STABLE, first?.stability)
    }

    @Test
    fun usbWithoutSerialFallsBackToSessionScopedDevicePath() {
        val fingerprint = PrinterPhysicalFingerprint.usb(
            vendorId = 1048,
            productId = 20497,
            serialNumber = null,
            deviceName = "/dev/bus/usb/001/012"
        )

        assertEquals("usb:vid0418:pid5011:path:dev_bus_usb_001_012", fingerprint?.value)
        assertEquals(PrinterPhysicalFingerprint.Stability.SESSION_SCOPED, fingerprint?.stability)
    }

    @Test
    fun usbVidPidWithoutSerialOrPathFailsClosed() {
        assertNull(PrinterPhysicalFingerprint.usb(1048, 20497, null, null))
    }

    @Test
    fun bluetoothMacNormalizesSeparatorsAndCase() {
        val colon = PrinterPhysicalFingerprint.bluetooth("00:01:02:03:0A:0B")
        val dash = PrinterPhysicalFingerprint.bluetooth("00-01-02-03-0a-0b")

        assertEquals(colon, dash)
        assertEquals("bluetooth:mac:000102030a0b", colon?.value)
        assertEquals(PrinterPhysicalFingerprint.Stability.STABLE, colon?.stability)
    }

    @Test
    fun invalidBluetoothIdentityFailsClosed() {
        assertNull(PrinterPhysicalFingerprint.bluetooth(null))
        assertNull(PrinterPhysicalFingerprint.bluetooth("Inner Printer"))
        assertNull(PrinterPhysicalFingerprint.bluetooth("00:01:02:03:0A"))
    }

    @Test
    fun lanFingerprintUsesNormalizedHostAndValidatedPort() {
        val fingerprint = PrinterPhysicalFingerprint.lan(" Printer.Local ", 9100)

        assertEquals("lan:host:printer.local:port:9100", fingerprint?.value)
        assertEquals(PrinterPhysicalFingerprint.Stability.ENDPOINT_SCOPED, fingerprint?.stability)
        assertNull(PrinterPhysicalFingerprint.lan("printer.local", 0))
        assertNull(PrinterPhysicalFingerprint.lan("", 9100))
    }
}
