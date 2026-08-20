package com.cpipos.pos

import org.junit.Assert.assertEquals
import org.junit.Test

class PrinterAssignmentProtectionPolicyTest {
    @Test
    fun noExistingAndNoDiscoveryDoesNothing() {
        assertEquals(
            PrinterAssignmentProtectionPolicy.Decision.NO_ACTION,
            PrinterAssignmentProtectionPolicy.decide(null, null)
        )
    }

    @Test
    fun discoveryCanBeUsedOnlyWhenNoExistingAssignmentExists() {
        assertEquals(
            PrinterAssignmentProtectionPolicy.Decision.USE_DISCOVERED,
            PrinterAssignmentProtectionPolicy.decide(null, "bluetooth:mac:000102030a0b")
        )
    }

    @Test
    fun matchingPhysicalFingerprintPreservesExistingAssignment() {
        assertEquals(
            PrinterAssignmentProtectionPolicy.Decision.KEEP_EXISTING,
            PrinterAssignmentProtectionPolicy.decide(
                " USB:VID0418:PID5011:SERIAL:18E1D0005C21 ",
                "usb:vid0418:pid5011:serial:18e1d0005c21"
            )
        )
    }

    @Test
    fun missingDiscoveredPrinterKeepsExistingAssignmentOffline() {
        assertEquals(
            PrinterAssignmentProtectionPolicy.Decision.KEEP_EXISTING_OFFLINE,
            PrinterAssignmentProtectionPolicy.decide(
                "usb:vid0418:pid5011:serial:18e1d0005c21",
                null
            )
        )
    }

    @Test
    fun differentPhysicalPrinterRequiresExplicitConfirmation() {
        assertEquals(
            PrinterAssignmentProtectionPolicy.Decision.REQUIRE_CONFIRMATION,
            PrinterAssignmentProtectionPolicy.decide(
                "usb:vid0418:pid5011:serial:18e1d0005c21",
                "bluetooth:mac:000102030a0b"
            )
        )
    }
}
