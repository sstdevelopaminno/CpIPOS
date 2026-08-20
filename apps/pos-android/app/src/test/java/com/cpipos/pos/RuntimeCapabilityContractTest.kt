package com.cpipos.pos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RuntimeCapabilityContractTest {
    @Test
    fun modernReleaseAdvertisesBoundedVerificationAndNonForcedUpdateNotice() {
        val model = RuntimeCapabilityContract.model(
            runtimeName = "android-pos-webview-mdm-lite",
            appVersionName = "999.999",
            appVersionCode = 999,
            presentationDisplayAvailable = true
        )

        assertEquals(3, model.schemaVersion)
        assertTrue(model.presentationDisplayAvailable)
        assertEquals(2, model.printer.inventorySchemaVersion)
        assertEquals(1, model.printer.physicalFingerprintSchemaVersion)
        assertTrue(model.printer.usbDiscovery)
        assertTrue(model.printer.bluetoothBondedInventory)
        assertTrue(model.printer.lanEscPosTransport)
        assertTrue(model.printer.explicitAssignmentFirst)
        assertTrue(model.printer.targetProbe)
        assertTrue(model.printer.oneTimeVerificationPrint)
        assertTrue(model.printer.verificationPrint)

        assertFalse(model.printer.lanDiscovery)
        assertFalse(model.printer.vendorDiscovery)
        assertFalse(model.printer.automaticReassignment)
        assertFalse(model.printer.autoSetup)
        assertEquals(
            "preserve_existing_or_require_confirmation",
            model.printer.assignmentProtection
        )

        assertEquals("modern", model.updates.channel)
        assertTrue(model.updates.managedNotice)
        assertFalse(model.updates.silentInstall)
        assertFalse(model.updates.forcedUpdate)
    }
}
