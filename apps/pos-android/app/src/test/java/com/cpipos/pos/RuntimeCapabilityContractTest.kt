package com.cpipos.pos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RuntimeCapabilityContractTest {
    @Test
    fun phaseAAdvertisesIdentityWithoutEnablingAutomaticMutation() {
        val model = RuntimeCapabilityContract.model(
            runtimeName = "android-pos-webview-mdm-lite",
            appVersionName = "999.999",
            appVersionCode = 999,
            presentationDisplayAvailable = true
        )

        assertEquals(1, model.schemaVersion)
        assertTrue(model.presentationDisplayAvailable)
        assertEquals(2, model.printer.inventorySchemaVersion)
        assertEquals(1, model.printer.physicalFingerprintSchemaVersion)
        assertTrue(model.printer.usbDiscovery)
        assertTrue(model.printer.bluetoothBondedInventory)
        assertTrue(model.printer.lanEscPosTransport)
        assertTrue(model.printer.explicitAssignmentFirst)

        assertFalse(model.printer.lanDiscovery)
        assertFalse(model.printer.vendorDiscovery)
        assertFalse(model.printer.automaticReassignment)
        assertFalse(model.printer.autoSetup)
        assertFalse(model.printer.verificationPrint)
        assertEquals(
            "preserve_existing_or_require_confirmation",
            model.printer.assignmentProtection
        )
    }
}
