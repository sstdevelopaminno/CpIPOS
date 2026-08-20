package com.cpipos.pos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PrinterVerificationTargetTest {
    @Test
    fun parsesCanonicalUsbSerialFingerprint() {
        val target = PrinterVerificationTarget.parse("usb:vid0418:pid5011:serial:18e1d0005c21")
        assertTrue(target is PrinterVerificationTarget.Usb)
        target as PrinterVerificationTarget.Usb
        assertEquals(0x0418, target.vendorId)
        assertEquals(0x5011, target.productId)
        assertEquals("serial", target.identityKind)
        assertEquals("18e1d0005c21", target.identityToken)
    }

    @Test
    fun parsesBluetoothMacAndFormatsAndroidAddress() {
        val target = PrinterVerificationTarget.parse("bluetooth:mac:000102030a0b")
        assertTrue(target is PrinterVerificationTarget.Bluetooth)
        target as PrinterVerificationTarget.Bluetooth
        assertEquals("00:01:02:03:0A:0B", target.address)
    }

    @Test
    fun parsesLanEndpoint() {
        val target = PrinterVerificationTarget.parse("lan:host:192.168.1.44:port:9100")
        assertTrue(target is PrinterVerificationTarget.Lan)
        target as PrinterVerificationTarget.Lan
        assertEquals("192.168.1.44", target.host)
        assertEquals(9100, target.port)
    }

    @Test
    fun rejectsFriendlyNamesAndMalformedEndpoints() {
        assertNull(PrinterVerificationTarget.parse("GLPrinter80"))
        assertNull(PrinterVerificationTarget.parse("usb:vid0418:pid5011"))
        assertNull(PrinterVerificationTarget.parse("bluetooth:mac:00010203"))
        assertNull(PrinterVerificationTarget.parse("lan:host:printer:port:70000"))
    }
}
