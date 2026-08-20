package com.cpipos.pos

import android.Manifest
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Read-only hardware inventory for printer-capability diagnostics.
 *
 * This class deliberately does not request permissions, open devices, bind profiles,
 * send bytes, scan the LAN, or change printer assignments. Its only purpose is to
 * report what Android can currently see so CpIPOS can choose a transport by capability
 * instead of by POS model or screen count.
 */
internal class PrinterCapabilityInventory(context: Context) {
    private val appContext = context.applicationContext
    private val packageManager = appContext.packageManager
    private val usbManager = appContext.getSystemService(UsbManager::class.java)
    private val bluetoothManager = appContext.getSystemService(BluetoothManager::class.java)

    fun snapshot(): JSONObject = JSONObject()
        .put("schema_version", 2)
        .put("captured_at_ms", System.currentTimeMillis())
        .put(
            "transport_support",
            JSONObject()
                .put("lan_escpos", true)
                .put("usb_host", packageManager.hasSystemFeature(PackageManager.FEATURE_USB_HOST))
                .put("bluetooth", packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH))
                .put("selection_policy", "explicit_assignment_first")
                .put("automatic_reassignment", false)
        )
        .put("usb", buildUsbSnapshot())
        .put("bluetooth", buildBluetoothSnapshot())
        .put("platform_hints", buildPlatformHints())

    private fun buildUsbSnapshot(): JSONObject {
        val manager = usbManager
        if (manager == null) {
            return JSONObject()
                .put("supported", false)
                .put("device_count", 0)
                .put("printable_candidate_count", 0)
                .put("safe_autobind_candidate_count", 0)
                .put("devices", JSONArray())
        }

        val devices = manager.deviceList.values
            .sortedWith(compareBy<UsbDevice>({ it.vendorId }, { it.productId }, { it.deviceName }, { it.deviceId }))
        val rows = JSONArray()
        var printableCandidateCount = 0
        var safeAutobindCandidateCount = 0

        devices.forEach { device ->
            val endpointSummary = inspectUsbEndpoints(device)
            val hasPermission = manager.hasPermission(device)
            val manufacturerName = runCatching { device.manufacturerName?.trim() }.getOrNull()
            val productName = runCatching { device.productName?.trim() }.getOrNull()
            val serialNumber = if (hasPermission) {
                runCatching { device.serialNumber?.trim()?.takeIf { it.isNotEmpty() } }.getOrNull()
            } else {
                null
            }
            val printerNameHint = listOf(manufacturerName, productName)
                .filterNotNull()
                .any(PrinterCapabilityHints::looksLikePrinterName)
            val nativeTransportCandidate = endpointSummary.writableEndpointCount > 0
            val safeAutobindCandidate = PrinterSelectionPolicy.usbMayAutoSelect(
                hasPrinterClassInterface = endpointSummary.printerClassInterfaceCount > 0,
                manufacturerName = manufacturerName,
                productName = productName
            )

            if (nativeTransportCandidate) printableCandidateCount += 1
            if (safeAutobindCandidate) safeAutobindCandidateCount += 1

            rows.put(
                JSONObject()
                    .put("device_id", device.deviceId)
                    .put("device_name", device.deviceName)
                    .put("vendor_id", device.vendorId)
                    .put("product_id", device.productId)
                    .put("device_class", device.deviceClass)
                    .put("device_subclass", device.deviceSubclass)
                    .put("device_protocol", device.deviceProtocol)
                    .put("interface_count", device.interfaceCount)
                    .put("has_permission", hasPermission)
                    .put("manufacturer_name", manufacturerName)
                    .put("product_name", productName)
                    .put("serial_number", serialNumber)
                    .put("printer_class_interface_count", endpointSummary.printerClassInterfaceCount)
                    .put("writable_endpoint_count", endpointSummary.writableEndpointCount)
                    .put("bulk_out_endpoint_count", endpointSummary.bulkOutEndpointCount)
                    .put("interrupt_out_endpoint_count", endpointSummary.interruptOutEndpointCount)
                    .put("printer_name_hint", printerNameHint)
                    .put("native_transport_candidate", nativeTransportCandidate)
                    .put("safe_autobind_candidate", safeAutobindCandidate)
            )
        }

        return JSONObject()
            .put("supported", packageManager.hasSystemFeature(PackageManager.FEATURE_USB_HOST))
            .put("device_count", devices.size)
            .put("printable_candidate_count", printableCandidateCount)
            .put("safe_autobind_candidate_count", safeAutobindCandidateCount)
            .put("devices", rows)
    }

    private data class UsbEndpointSummary(
        val printerClassInterfaceCount: Int,
        val writableEndpointCount: Int,
        val bulkOutEndpointCount: Int,
        val interruptOutEndpointCount: Int
    )

    private fun inspectUsbEndpoints(device: UsbDevice): UsbEndpointSummary {
        var printerClassInterfaceCount = 0
        var writableEndpointCount = 0
        var bulkOutEndpointCount = 0
        var interruptOutEndpointCount = 0

        for (interfaceIndex in 0 until device.interfaceCount) {
            val usbInterface = device.getInterface(interfaceIndex)
            if (usbInterface.interfaceClass == UsbConstants.USB_CLASS_PRINTER) {
                printerClassInterfaceCount += 1
            }
            for (endpointIndex in 0 until usbInterface.endpointCount) {
                val endpoint = usbInterface.getEndpoint(endpointIndex)
                if (endpoint.direction != UsbConstants.USB_DIR_OUT) continue
                when (endpoint.type) {
                    UsbConstants.USB_ENDPOINT_XFER_BULK -> {
                        writableEndpointCount += 1
                        bulkOutEndpointCount += 1
                    }
                    UsbConstants.USB_ENDPOINT_XFER_INT -> {
                        writableEndpointCount += 1
                        interruptOutEndpointCount += 1
                    }
                }
            }
        }

        return UsbEndpointSummary(
            printerClassInterfaceCount = printerClassInterfaceCount,
            writableEndpointCount = writableEndpointCount,
            bulkOutEndpointCount = bulkOutEndpointCount,
            interruptOutEndpointCount = interruptOutEndpointCount
        )
    }

    @Suppress("DEPRECATION")
    private fun buildBluetoothSnapshot(): JSONObject {
        val adapter = bluetoothManager?.adapter
        val supported = adapter != null
        val connectPermissionGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            ContextCompat.checkSelfPermission(appContext, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

        val result = JSONObject()
            .put("supported", supported)
            .put("connect_permission_granted", connectPermissionGranted)
            .put("enabled", if (supported && connectPermissionGranted) runCatching { adapter?.isEnabled }.getOrNull() else null)
            .put("bonded_device_count", 0)
            .put("printer_name_hint_count", 0)
            .put("spp_candidate_count", 0)
            .put("bonded_devices", JSONArray())

        if (!supported || !connectPermissionGranted || adapter == null) return result

        val bonded = runCatching { adapter.bondedDevices.orEmpty().toList() }.getOrElse { emptyList() }
            .sortedWith(compareBy({ runCatching { it.name.orEmpty() }.getOrDefault("") }, { runCatching { it.address.orEmpty() }.getOrDefault("") }))
        val rows = JSONArray()
        var printerHintCount = 0
        var sppCandidateCount = 0

        bonded.forEach { device ->
            val name = runCatching { device.name?.trim() }.getOrNull()
            val address = runCatching { device.address?.trim() }.getOrNull()
            val printerNameHint = PrinterSelectionPolicy.bluetoothMayAutoSelect(name)
            val serviceUuids = runCatching {
                device.uuids.orEmpty().map { it.uuid.toString().lowercase() }.distinct().sorted()
            }.getOrElse { emptyList() }
            val sppUuidPresent = serviceUuids.any { it == SPP_UUID }
            if (printerNameHint) printerHintCount += 1
            if (printerNameHint && sppUuidPresent) sppCandidateCount += 1
            rows.put(
                JSONObject()
                    .put("name", name)
                    .put("address", address)
                    .put("bond_state", device.bondState)
                    .put("device_type", device.type)
                    .put("device_class", device.bluetoothClass?.deviceClass)
                    .put("printer_name_hint", printerNameHint)
                    .put("service_uuids", JSONArray(serviceUuids))
                    .put("spp_uuid_present", sppUuidPresent)
            )
        }

        return result
            .put("enabled", runCatching { adapter.isEnabled }.getOrNull())
            .put("bonded_device_count", bonded.size)
            .put("printer_name_hint_count", printerHintCount)
            .put("spp_candidate_count", sppCandidateCount)
            .put("bonded_devices", rows)
    }

    private fun buildPlatformHints(): JSONObject {
        val featureHints = packageManager.systemAvailableFeatures.orEmpty()
            .mapNotNull { it.name?.trim() }
            .filter(PrinterCapabilityHints::looksLikePrinterFeature)
            .distinct()
            .sorted()
        val sharedLibraryHints = packageManager.systemSharedLibraryNames.orEmpty()
            .map { it.trim() }
            .filter(PrinterCapabilityHints::looksLikePrinterFeature)
            .distinct()
            .sorted()
        val vendorSpecificHints = (featureHints + sharedLibraryHints)
            .filterNot { it.equals("android.software.print", ignoreCase = true) }
            .distinct()
            .sorted()

        return JSONObject()
            .put("manufacturer", Build.MANUFACTURER)
            .put("brand", Build.BRAND)
            .put("model", Build.MODEL)
            .put("device", Build.DEVICE)
            .put("product", Build.PRODUCT)
            .put("system_feature_hints", JSONArray(featureHints))
            .put("shared_library_hints", JSONArray(sharedLibraryHints))
            .put("vendor_specific_print_hints", JSONArray(vendorSpecificHints))
            .put("vendor_printer_integration_hint_present", vendorSpecificHints.isNotEmpty())
    }

    companion object {
        private const val SPP_UUID = "00001101-0000-1000-8000-00805f9b34fb"
    }
}

internal object PrinterCapabilityHints {
    private val printerNameTokens = listOf(
        "printer",
        "thermal",
        "escpos",
        "esc/pos",
        "receipt",
        "pos58",
        "pos80",
        "xp-",
        "rp-",
        "pt-",
        "tm-"
    )

    private val platformFeatureTokens = listOf(
        "printer",
        "print",
        "thermal",
        "escpos",
        "esc.pos",
        "landi",
        "landicorp"
    )

    fun looksLikePrinterName(value: String?): Boolean {
        val normalized = value.orEmpty().trim().lowercase()
        if (normalized.isEmpty()) return false
        return printerNameTokens.any(normalized::contains)
    }

    fun looksLikePrinterFeature(value: String?): Boolean {
        val normalized = value.orEmpty().trim().lowercase()
        if (normalized.isEmpty()) return false
        return platformFeatureTokens.any(normalized::contains)
    }
}
