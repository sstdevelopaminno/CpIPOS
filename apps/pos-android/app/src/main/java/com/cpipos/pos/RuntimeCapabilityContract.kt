package com.cpipos.pos

import org.json.JSONObject

/**
 * Explicit runtime capability contract reported by Android MDM diagnostics.
 *
 * Web/backend consumers must use this contract instead of inferring features from APK
 * version numbers. Phase B adds targeted probe + one-time verification print while keeping
 * automatic setup and automatic reassignment disabled.
 */
internal object RuntimeCapabilityContract {
    const val SCHEMA_VERSION = 2
    const val PRINTER_FINGERPRINT_SCHEMA_VERSION = 1
    const val PRINTER_INVENTORY_SCHEMA_VERSION = 2

    data class Model(
        val schemaVersion: Int,
        val runtimeName: String,
        val appVersionName: String,
        val appVersionCode: Int,
        val presentationDisplayAvailable: Boolean,
        val printer: PrinterCapabilities
    )

    data class PrinterCapabilities(
        val inventorySchemaVersion: Int,
        val physicalFingerprintSchemaVersion: Int,
        val usbDiscovery: Boolean,
        val bluetoothBondedInventory: Boolean,
        val lanDiscovery: Boolean,
        val vendorDiscovery: Boolean,
        val lanEscPosTransport: Boolean,
        val explicitAssignmentFirst: Boolean,
        val targetProbe: Boolean,
        val oneTimeVerificationPrint: Boolean,
        val automaticReassignment: Boolean,
        val autoSetup: Boolean,
        val verificationPrint: Boolean,
        val assignmentProtection: String
    )

    fun model(
        runtimeName: String,
        appVersionName: String,
        appVersionCode: Int,
        presentationDisplayAvailable: Boolean
    ): Model = Model(
        schemaVersion = SCHEMA_VERSION,
        runtimeName = runtimeName,
        appVersionName = appVersionName,
        appVersionCode = appVersionCode,
        presentationDisplayAvailable = presentationDisplayAvailable,
        printer = PrinterCapabilities(
            inventorySchemaVersion = PRINTER_INVENTORY_SCHEMA_VERSION,
            physicalFingerprintSchemaVersion = PRINTER_FINGERPRINT_SCHEMA_VERSION,
            usbDiscovery = true,
            bluetoothBondedInventory = true,
            lanDiscovery = false,
            vendorDiscovery = false,
            lanEscPosTransport = true,
            explicitAssignmentFirst = true,
            targetProbe = true,
            oneTimeVerificationPrint = true,
            automaticReassignment = false,
            autoSetup = false,
            verificationPrint = true,
            assignmentProtection = "preserve_existing_or_require_confirmation"
        )
    )

    fun toJson(model: Model): JSONObject = JSONObject()
        .put("schema_version", model.schemaVersion)
        .put("runtime", model.runtimeName)
        .put("version_name", model.appVersionName)
        .put("version_code", model.appVersionCode)
        .put(
            "displays",
            JSONObject()
                .put("presentation_display_available", model.presentationDisplayAvailable)
        )
        .put(
            "printer",
            JSONObject()
                .put("inventory_schema_version", model.printer.inventorySchemaVersion)
                .put("physical_fingerprint_schema_version", model.printer.physicalFingerprintSchemaVersion)
                .put("usb_discovery", model.printer.usbDiscovery)
                .put("bluetooth_bonded_inventory", model.printer.bluetoothBondedInventory)
                .put("lan_discovery", model.printer.lanDiscovery)
                .put("vendor_discovery", model.printer.vendorDiscovery)
                .put("lan_escpos_transport", model.printer.lanEscPosTransport)
                .put("explicit_assignment_first", model.printer.explicitAssignmentFirst)
                .put("target_probe", model.printer.targetProbe)
                .put("one_time_verification_print", model.printer.oneTimeVerificationPrint)
                .put("automatic_reassignment", model.printer.automaticReassignment)
                .put("auto_setup", model.printer.autoSetup)
                .put("verification_print", model.printer.verificationPrint)
                .put("assignment_protection", model.printer.assignmentProtection)
        )
}
