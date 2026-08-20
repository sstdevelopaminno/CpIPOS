package com.cpipos.pos

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Test

class PrinterVerificationPolicyTest {
    private val now = 2_000_000L

    @Test
    fun probeAllowsExplicitTargetInsideBoundedWindow() {
        val result = PrinterVerificationPolicy.validate(
            PrinterVerificationPolicy.Request(
                commandId = "cmd-probe-1",
                mode = PrinterVerificationPolicy.Mode.PROBE,
                targetFingerprint = "usb:vid0418:pid5011:path:dev_bus_usb_001_002",
                issuedAtMs = now - 1_000,
                expiresAtMs = now + 60_000,
                operatorConfirmed = false
            ),
            now
        )
        assertTrue(result.allowed)
        assertEquals("ok", result.code)
    }

    @Test
    fun verificationPrintRequiresOperatorConfirmation() {
        val result = PrinterVerificationPolicy.validate(
            PrinterVerificationPolicy.Request(
                commandId = "cmd-print-1",
                mode = PrinterVerificationPolicy.Mode.VERIFICATION_PRINT,
                targetFingerprint = "bluetooth:mac:000102030a0b",
                issuedAtMs = now - 1_000,
                expiresAtMs = now + 60_000,
                operatorConfirmed = false
            ),
            now
        )
        assertFalse(result.allowed)
        assertEquals("verification_operator_confirmation_required", result.code)
    }

    @Test
    fun verificationPrintRejectsLongReplayWindow() {
        val result = PrinterVerificationPolicy.validate(
            PrinterVerificationPolicy.Request(
                commandId = "cmd-print-2",
                mode = PrinterVerificationPolicy.Mode.VERIFICATION_PRINT,
                targetFingerprint = "lan:host:192.168.1.44:port:9100",
                issuedAtMs = now,
                expiresAtMs = now + 6 * 60_000L,
                operatorConfirmed = true
            ),
            now
        )
        assertFalse(result.allowed)
        assertEquals("verification_window_too_long", result.code)
    }

    @Test
    fun rejectsExpiredAndNonCanonicalTarget() {
        val expired = PrinterVerificationPolicy.validate(
            PrinterVerificationPolicy.Request(
                commandId = "cmd-expired",
                mode = PrinterVerificationPolicy.Mode.PROBE,
                targetFingerprint = "usb:vid0418:pid5011:serial:abc123",
                issuedAtMs = now - 120_000,
                expiresAtMs = now - 1,
                operatorConfirmed = false
            ),
            now
        )
        assertFalse(expired.allowed)
        assertEquals("verification_command_expired", expired.code)

        val malformed = PrinterVerificationPolicy.validate(
            PrinterVerificationPolicy.Request(
                commandId = "cmd-bad-target",
                mode = PrinterVerificationPolicy.Mode.PROBE,
                targetFingerprint = "Inner Printer",
                issuedAtMs = now - 1_000,
                expiresAtMs = now + 60_000,
                operatorConfirmed = false
            ),
            now
        )
        assertFalse(malformed.allowed)
        assertEquals("verification_target_invalid", malformed.code)
    }
}
