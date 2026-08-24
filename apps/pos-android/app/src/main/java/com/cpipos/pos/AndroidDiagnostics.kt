package com.cpipos.pos

import android.Manifest
import android.annotation.SuppressLint
import android.app.admin.DevicePolicyManager
import android.bluetooth.BluetoothManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.StatFs
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID

class AndroidDiagnostics(context: Context) {
    private val appContext = context.applicationContext
    private val printerPrefs = appContext.getSharedPreferences("cpipos_tablet_pos_printer", Context.MODE_PRIVATE)
    private val devicePolicyManager = appContext.getSystemService(DevicePolicyManager::class.java)
    private val deviceAdminComponent = ComponentName(appContext, CpiposDeviceAdminReceiver::class.java)
    private val usbManager = appContext.getSystemService(UsbManager::class.java)
    private val bluetoothManager = appContext.getSystemService(BluetoothManager::class.java)

    fun networkOnline(): Boolean {
        val manager = appContext.getSystemService(ConnectivityManager::class.java) ?: return false
        val network = manager.activeNetwork ?: return false
        val caps = manager.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    fun networkType(): String {
        val manager = appContext.getSystemService(ConnectivityManager::class.java) ?: return "unknown"
        val network = manager.activeNetwork ?: return "offline"
        val caps = manager.getNetworkCapabilities(network) ?: return "unknown"
        return when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            else -> "other"
        }
    }

    fun appMemoryMb(): Long {
        val runtime = Runtime.getRuntime()
        return ((runtime.totalMemory() - runtime.freeMemory()) / (1024 * 1024)).coerceAtLeast(0)
    }

    fun availableStorageMb(): Long {
        val stat = StatFs(appContext.filesDir.absolutePath)
        return (stat.availableBytes / (1024 * 1024)).coerceAtLeast(0)
    }

    fun batteryPercent(): Int? {
        val manager = appContext.getSystemService(BatteryManager::class.java) ?: return null
        val value = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return value.takeIf { it >= 0 }
    }

    fun isDeviceOwnerKnown(): Boolean? = devicePolicyManager?.isDeviceOwnerApp(appContext.packageName)

    fun isDeviceAdminActive(): Boolean = devicePolicyManager?.isAdminActive(deviceAdminComponent) == true

    fun printerHost(): String? = printerPrefs.getString("host", null)?.trim()?.takeIf { it.isNotBlank() }

    fun printerPort(): Int? = printerPrefs.getInt("port", 9100).takeIf { it in 1..65535 }

    fun savePrinter(host: String, port: Int) {
        printerPrefs.edit().putString("host", host.trim()).putInt("port", port).apply()
    }

    fun testPrinterConnection(timeoutMs: Int = 2500): PrinterDiagnostic {
        val host = printerHost()
        val port = printerPort()
        if (host == null || port == null) return PrinterDiagnostic(host, port, null, "printer_not_configured")
        return try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(host, port), timeoutMs)
            }
            PrinterDiagnostic(host, port, true, null)
        } catch (error: Exception) {
            PrinterDiagnostic(host, port, false, error.message ?: error::class.java.simpleName)
        }
    }

    fun runtimeCapabilities(): JSONObject = JSONObject()
        .put("schema_version", 4)
        .put(
            "updates",
            JSONObject()
                .put("channel", BuildConfig.CPIPOS_UPDATE_CHANNEL)
                .put("managed_notice", BuildConfig.CPIPOS_MANAGED_UPDATER_ENABLED)
                .put("silent_install", false)
                .put("forced_update", false)
        )
        .put(
            "printer",
            JSONObject()
                .put("target_probe", true)
                .put("one_time_verification_print", true)
                .put("explicit_assignment_first", true)
                .put("bluetooth_exact_bonded_verification", true)
                .put("auto_setup", true)
                .put("automatic_reassignment", false)
                .put("assignment_protection", "preserve_existing_or_require_confirmation")
        )

    fun printerInventory(): JSONObject = JSONObject()
        .put("usb", buildUsbInventory())
        .put("bluetooth", buildBluetoothInventory())

    fun testPrinterVerification(envelope: JSONObject?): JSONObject {
        val source = envelope ?: JSONObject()
        val mode = source.optString("mode", "").trim().lowercase()
        val targetFingerprint = source.optString("target_fingerprint", "").trim().lowercase()
        val issuedAtMs = source.optLong("issued_at_ms", 0L)
        val expiresAtMs = source.optLong("expires_at_ms", 0L)
        val nowMs = System.currentTimeMillis()

        if (mode != "probe" && mode != "verification_print") {
            return verificationResult(false, false, true, "verification_mode_invalid", false, "Unsupported printer verification mode")
        }
        if (targetFingerprint.isBlank()) {
            return verificationResult(false, false, true, "verification_target_missing", false, "Printer verification target is missing")
        }
        if (source.optBoolean("operator_confirmed") != true) {
            return verificationResult(false, false, true, "verification_operator_confirmation_required", false, "Printer verification requires explicit operator confirmation")
        }
        if (issuedAtMs <= 0L || expiresAtMs <= issuedAtMs || nowMs > expiresAtMs) {
            return verificationResult(false, false, true, "verification_window_expired", false, "Printer verification command expired")
        }

        val profile = printerProfileForFingerprint(targetFingerprint)
            ?: return verificationResult(false, false, true, "verification_target_not_found", true, "Target printer is not connected or permission is missing")

        if (mode == "probe") {
            return verificationResult(true, false, true, "verification_probe_ok", false, null)
                .put("target_fingerprint", targetFingerprint)
                .put("transport", profile.metadata.optString("transport_mode", profile.connectionType))
        }

        return try {
            val result = NativePrintTransport(appContext).print(
                NativePrintJob(
                    id = "printer-verification",
                    attemptId = UUID.randomUUID().toString(),
                    payloadText = "CpIPOS printer verification\nDevice: ${Build.MODEL}\nTime: ${System.currentTimeMillis()}\n\n",
                    metadata = JSONObject().put("command", "printer_verification"),
                    printer = profile
                )
            )
            verificationResult(true, true, true, "verification_print_ok", false, null)
                .put("target_fingerprint", targetFingerprint)
                .put("transport", result.transport)
                .put("bytes_sent", result.bytesSent)
        } catch (error: NativePrintException) {
            verificationResult(false, false, true, error.code, error.retryable, error.message)
        } catch (error: Throwable) {
            verificationResult(false, false, true, "verification_print_failed", true, error.message ?: "Printer verification failed")
        }
    }

    private fun verificationResult(ok: Boolean, printed: Boolean, consumed: Boolean, code: String, retryable: Boolean, message: String?): JSONObject =
        JSONObject()
            .put("ok", ok)
            .put("printed", printed)
            .put("consumed", consumed)
            .put("code", code)
            .put("retryable", retryable)
            .put("message", message)

    private fun buildUsbInventory(): JSONObject {
        val manager = usbManager ?: return JSONObject().put("supported", false).put("devices", JSONArray())
        val rows = JSONArray()
        manager.deviceList.values
            .sortedWith(compareBy<UsbDevice>({ it.vendorId }, { it.productId }, { it.deviceName }, { it.deviceId }))
            .forEach { device -> rows.put(usbDeviceJson(manager, device)) }
        return JSONObject().put("supported", true).put("devices", rows)
    }

    private fun usbDeviceJson(manager: UsbManager, device: UsbDevice): JSONObject {
        val hasPermission = manager.hasPermission(device)
        val productName = safeUsbText { device.productName }
        val manufacturerName = safeUsbText { device.manufacturerName }
        val serialNumber = if (hasPermission) safeUsbText { device.serialNumber } else null
        val usbEvidence = usbEvidence(device)
        val printerNameHint = PrinterHardwareClassifier.hasPrinterNameHint(productName, manufacturerName, device.deviceName)
        val safeAutobind = usbEvidence.hasWritableEndpoint && PrinterHardwareClassifier.usbSafeAutobindCandidate(
            usbEvidence.usbPrinterClass,
            printerNameHint
        )
        val fingerprint = PrinterHardwareClassifier.usbFingerprint(device.vendorId, device.productId, serialNumber, device.deviceName)

        return JSONObject()
            .put("vendor_id", device.vendorId)
            .put("product_id", device.productId)
            .put("device_id", device.deviceId)
            .put("device_name", device.deviceName)
            .put("product_name", productName)
            .put("manufacturer_name", manufacturerName)
            .put("serial_number", serialNumber)
            .put("device_class", device.deviceClass)
            .put("device_subclass", device.deviceSubclass)
            .put("device_protocol", device.deviceProtocol)
            .put("interface_count", device.interfaceCount)
            .put("has_permission", hasPermission)
            .put("has_writable_endpoint", usbEvidence.hasWritableEndpoint)
            .put("usb_printer_class", usbEvidence.usbPrinterClass)
            .put("printer_name_hint", printerNameHint)
            .put("native_transport_candidate", usbEvidence.hasWritableEndpoint)
            .put("safe_autobind_candidate", safeAutobind)
            .put("physical_fingerprint", fingerprint.value)
            .put("physical_fingerprint_stability", fingerprint.stability)
    }

    private fun usbEvidence(device: UsbDevice): UsbEvidence {
        var hasWritableEndpoint = false
        var usbPrinterClass = device.deviceClass == UsbConstants.USB_CLASS_PRINTER
        for (interfaceIndex in 0 until device.interfaceCount) {
            val usbInterface = device.getInterface(interfaceIndex)
            if (usbInterface.interfaceClass == UsbConstants.USB_CLASS_PRINTER) usbPrinterClass = true
            if (interfaceHasWritableEndpoint(usbInterface)) hasWritableEndpoint = true
        }
        return UsbEvidence(hasWritableEndpoint, usbPrinterClass)
    }

    private fun interfaceHasWritableEndpoint(usbInterface: UsbInterface): Boolean {
        for (endpointIndex in 0 until usbInterface.endpointCount) {
            val endpoint: UsbEndpoint = usbInterface.getEndpoint(endpointIndex)
            if (endpoint.direction != UsbConstants.USB_DIR_OUT) continue
            if (endpoint.type == UsbConstants.USB_ENDPOINT_XFER_BULK || endpoint.type == UsbConstants.USB_ENDPOINT_XFER_INT) return true
        }
        return false
    }

    @SuppressLint("MissingPermission")
    private fun buildBluetoothInventory(): JSONObject {
        val adapter = bluetoothManager?.adapter
        val connectPermission = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            ContextCompat.checkSelfPermission(appContext, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
        val rows = JSONArray()
        if (adapter != null && connectPermission) {
            runCatching { adapter.bondedDevices.orEmpty().toList() }.getOrDefault(emptyList())
                .sortedWith(compareBy({ safeBluetoothText { it.name } ?: "" }, { safeBluetoothText { it.address } ?: "" }))
                .forEach { device ->
                    val name = safeBluetoothText { device.name }
                    val address = safeBluetoothText { device.address }
                    val sppUuidPresent = runCatching { device.uuids.orEmpty().any { parcel -> parcel.uuid == SPP_UUID } }.getOrDefault(false)
                    val fingerprint = PrinterHardwareClassifier.bluetoothFingerprint(address)
                    rows.put(
                        JSONObject()
                            .put("name", name)
                            .put("address", address)
                            .put("bond_state", safeBluetoothInt { device.bondState })
                            .put("device_type", safeBluetoothInt { device.type })
                            .put("device_class", safeBluetoothInt { device.bluetoothClass?.deviceClass ?: -1 }?.takeIf { it >= 0 })
                            .put("spp_uuid_present", sppUuidPresent)
                            .put("printer_name_hint", PrinterHardwareClassifier.bluetoothPrinterHint(name, sppUuidPresent))
                            .put("physical_fingerprint", fingerprint?.value)
                            .put("physical_fingerprint_stability", fingerprint?.stability ?: "unknown")
                    )
                }
        }
        return JSONObject()
            .put("supported", adapter != null)
            .put("enabled", adapter?.let { safeBluetoothBoolean { it.isEnabled } } == true)
            .put("connect_permission_granted", connectPermission)
            .put("bonded_devices", rows)
    }

    private fun printerProfileForFingerprint(fingerprint: String): NativePrinterProfile? {
        val manager = usbManager
        if (fingerprint.startsWith("usb:") && manager != null) {
            manager.deviceList.values.forEach { device ->
                val row = usbDeviceJson(manager, device)
                if (row.optString("physical_fingerprint", "").lowercase() == fingerprint) {
                    return NativePrinterProfile(
                        id = fingerprint,
                        name = row.optString("product_name", "USB Printer"),
                        connectionType = "LOCAL_BRIDGE",
                        ipAddress = null,
                        port = null,
                        metadata = JSONObject()
                            .put("transport_mode", "usb")
                            .put("usb_vendor_id", row.optInt("vendor_id"))
                            .put("usb_product_id", row.optInt("product_id"))
                            .put("usb_device_name", row.optString("device_name"))
                            .put("usb_serial_number", row.optString("serial_number", "").takeIf { it.isNotBlank() })
                    )
                }
            }
        }

        val adapter = bluetoothManager?.adapter
        val connectPermission = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            ContextCompat.checkSelfPermission(appContext, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
        if (fingerprint.startsWith("bluetooth:") && adapter != null && connectPermission) {
            runCatching { adapter.bondedDevices.orEmpty().toList() }.getOrDefault(emptyList()).forEach { device ->
                val address = safeBluetoothText { device.address }
                val rowFingerprint = PrinterHardwareClassifier.bluetoothFingerprint(address)?.value
                if (rowFingerprint == fingerprint) {
                    return NativePrinterProfile(
                        id = fingerprint,
                        name = safeBluetoothText { device.name } ?: "Bluetooth Printer",
                        connectionType = "BLUETOOTH_BRIDGE",
                        ipAddress = null,
                        port = null,
                        metadata = JSONObject()
                            .put("transport_mode", "bluetooth")
                            .put("bluetooth_address", address)
                            .put("bluetooth_name", safeBluetoothText { device.name })
                    )
                }
            }
        }
        return null
    }

    private fun safeUsbText(read: () -> String?): String? = runCatching { read()?.trim()?.takeIf { it.isNotEmpty() } }.getOrNull()
    private fun safeBluetoothText(read: () -> String?): String? = runCatching { read()?.trim()?.takeIf { it.isNotEmpty() } }.getOrNull()
    private fun safeBluetoothInt(read: () -> Int): Int? = runCatching { read() }.getOrNull()
    private fun safeBluetoothBoolean(read: () -> Boolean): Boolean? = runCatching { read() }.getOrNull()

    private data class UsbEvidence(val hasWritableEndpoint: Boolean, val usbPrinterClass: Boolean)

    companion object {
        private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }
}
