package com.cpipos.pos

import android.Manifest
import android.app.PendingIntent
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import android.os.SystemClock
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.charset.Charset
import java.util.UUID

internal data class NativePrinterProfile(
    val id: String,
    val name: String,
    val connectionType: String,
    val ipAddress: String?,
    val port: Int?,
    val metadata: JSONObject
)

internal data class NativePrintJob(
    val id: String,
    val attemptId: String,
    val payloadText: String,
    val metadata: JSONObject,
    val printer: NativePrinterProfile
)

internal data class NativePrintResult(
    val bytesSent: Int,
    val transport: String,
    val providerJobId: String,
    val renderMode: String = "unknown",
    val payloadBuildMs: Long = 0L,
    val transportWriteMs: Long = 0L
)

internal class NativePrintException(
    val code: String,
    val retryable: Boolean,
    message: String,
    cause: Throwable? = null
) : Exception(message, cause)

internal class NativePrintTransport(context: Context) {
    private data class PreparedPayload(val bytes: ByteArray, val renderMode: String)

    private val appContext = context.applicationContext
    private val usbManager = appContext.getSystemService(UsbManager::class.java)
    private val bluetoothManager = appContext.getSystemService(BluetoothManager::class.java)
    private val htmlRasterizer = HtmlReceiptRasterizer(appContext)
    private val textRasterizer = NativeTextRasterizer()
    private val usbBindingPrefs = appContext.getSharedPreferences(USB_BINDING_PREFS, Context.MODE_PRIVATE)

    fun print(job: NativePrintJob): NativePrintResult {
        val mode = job.printer.metadata.optString("transport_mode", "").trim().lowercase()
        val payloadStartedAt = SystemClock.elapsedRealtime()
        val prepared = buildPayload(job)
        val payloadBuildMs = (SystemClock.elapsedRealtime() - payloadStartedAt).coerceAtLeast(0L)
        val transportStartedAt = SystemClock.elapsedRealtime()
        val result = when {
            job.printer.connectionType == "NETWORK_ESC_POS" || mode == "lan" -> printLan(job.printer, prepared.bytes)
            job.printer.connectionType == "LOCAL_BRIDGE" || mode == "usb" -> printUsb(job.printer, prepared.bytes)
            job.printer.connectionType == "BLUETOOTH_BRIDGE" || mode == "bluetooth" -> printBluetooth(job.printer, prepared.bytes)
            else -> throw NativePrintException(
                "unsupported_transport",
                false,
                "Unsupported printer transport: ${job.printer.connectionType}"
            )
        }
        val transportWriteMs = (SystemClock.elapsedRealtime() - transportStartedAt).coerceAtLeast(0L)
        return result.copy(
            renderMode = prepared.renderMode,
            payloadBuildMs = payloadBuildMs,
            transportWriteMs = transportWriteMs
        )
    }

    private fun buildPayload(job: NativePrintJob): PreparedPayload {
        val command = job.metadata.optString("command", "").trim().lowercase()
        if (command == "open_cash_drawer" || job.payloadText.trim() == "OPEN_CASH_DRAWER") {
            val pin = job.metadata.optInt("drawer_kick_pin", 0).coerceIn(0, 1)
            val onMs = job.metadata.optInt("drawer_pulse_on_ms", 50).coerceIn(2, 510)
            val offMs = job.metadata.optInt("drawer_pulse_off_ms", 250).coerceIn(2, 510)
            return PreparedPayload(
                byteArrayOf(
                    0x1B,
                    0x70,
                    pin.toByte(),
                    (onMs / 2).coerceIn(1, 255).toByte(),
                    (offMs / 2).coerceIn(1, 255).toByte()
                ),
                "command"
            )
        }

        val html = job.metadata.optString("payload_html", "").trim()
        val paperWidthMm = job.metadata.optInt("paper_width_mm", 58).let { if (it >= 80) 80 else 58 }
        val payloadFormat = job.metadata.optString("payload_format", "").trim().lowercase()
        val profileMetadata = job.printer.metadata
        val forceRichHtml = profileMetadata.optBoolean("force_rich_html_raster", false) ||
            job.metadata.optBoolean("force_rich_html_raster", false)

        // Kitchen payload_text currently contains only the queue/order summary while item rows live
        // in payload_json/HTML. Keep kitchen documents on the rich renderer until their text payload
        // carries complete item/notes content. Receipt/test payload_text is complete and safe to use.
        val fastRasterEligible = job.payloadText.isNotBlank() && (
            job.metadata.optBoolean("test_print", false) || payloadFormat == "receipt_html_v1"
            )

        if (fastRasterEligible && !forceRichHtml) {
            runCatching { textRasterizer.render(job.payloadText, paperWidthMm) }
                .getOrNull()
                ?.let { return PreparedPayload(it, "native_text_raster") }
        }

        if (html.isNotEmpty()) {
            return PreparedPayload(htmlRasterizer.render(html, paperWidthMm), "html_raster_fallback")
        }

        val charsetName = profileMetadata.optString("escpos_charset", "windows-874").trim().ifEmpty { "windows-874" }
        val charset = runCatching { Charset.forName(charsetName) }.getOrElse { Charsets.UTF_8 }
        val codeTable = profileMetadata.optInt("escpos_code_table", 26).coerceIn(0, 255)
        val feedLines = profileMetadata.optInt("feed_lines", 3).coerceIn(1, 8)
        val autoCut = profileMetadata.optBoolean("auto_cut", false)

        val output = ByteArrayOutputStream()
        output.write(byteArrayOf(0x1B, 0x40))
        output.write(byteArrayOf(0x1B, 0x74, codeTable.toByte()))
        output.write(job.payloadText.replace("\r\n", "\n").toByteArray(charset))
        repeat(feedLines) { output.write('\n'.code) }
        if (autoCut) output.write(byteArrayOf(0x1D, 0x56, 0x00))
        return PreparedPayload(output.toByteArray(), "escpos_text")
    }

    private fun printLan(printer: NativePrinterProfile, payload: ByteArray): NativePrintResult {
        val host = printer.ipAddress?.trim().orEmpty()
        if (host.isBlank()) throw NativePrintException("lan_ip_missing", false, "LAN printer IP is not configured")
        val port = (printer.port ?: 9100).coerceIn(1, 65535)
        try {
            Socket().use { socket ->
                socket.tcpNoDelay = true
                socket.connect(InetSocketAddress(host, port), 4_000)
                socket.soTimeout = 5_000
                socket.getOutputStream().use { output ->
                    output.write(payload)
                    output.flush()
                }
            }
            return NativePrintResult(payload.size, "lan", "android-lan:$host:$port")
        } catch (error: Throwable) {
            throw NativePrintException("lan_print_failed", true, error.message ?: "LAN print failed", error)
        }
    }

    private data class UsbTarget(
        val device: UsbDevice,
        val usbInterface: UsbInterface,
        val endpoint: UsbEndpoint
    )

    private fun printUsb(printer: NativePrinterProfile, payload: ByteArray): NativePrintResult {
        val manager = usbManager ?: throw NativePrintException("usb_not_supported", false, "USB host is not available")
        val target = findUsbTarget(printer)
            ?: throw NativePrintException("usb_printer_not_found", true, "No USB ESC/POS printer is connected")

        if (!manager.hasPermission(target.device)) {
            val permissionIntent = PendingIntent.getBroadcast(
                appContext,
                target.device.deviceId,
                Intent(USB_PERMISSION_ACTION).setPackage(appContext.packageName),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            manager.requestPermission(target.device, permissionIntent)
            throw NativePrintException(
                "usb_permission_required",
                true,
                "Android USB permission is required. Approve the printer permission dialog once."
            )
        }

        persistUsbBinding(printer.id, target.device)

        var connection: UsbDeviceConnection? = null
        try {
            connection = manager.openDevice(target.device)
                ?: throw NativePrintException("usb_open_failed", true, "Unable to open USB printer")
            if (!connection.claimInterface(target.usbInterface, true)) {
                throw NativePrintException("usb_claim_failed", true, "Unable to claim USB printer interface")
            }

            var offset = 0
            while (offset < payload.size) {
                val length = minOf(16_384, payload.size - offset)
                val sent = connection.bulkTransfer(target.endpoint, payload, offset, length, 5_000)
                if (sent <= 0) {
                    throw NativePrintException("usb_write_failed", true, "USB printer did not accept data")
                }
                offset += sent
            }

            return NativePrintResult(
                payload.size,
                "usb",
                "android-usb:${target.device.vendorId}:${target.device.productId}:${target.device.deviceId}"
            )
        } catch (error: NativePrintException) {
            throw error
        } catch (error: Throwable) {
            throw NativePrintException("usb_print_failed", true, error.message ?: "USB print failed", error)
        } finally {
            runCatching { connection?.releaseInterface(target.usbInterface) }
            runCatching { connection?.close() }
        }
    }

    private fun findUsbTarget(printer: NativePrinterProfile): UsbTarget? {
        val manager = usbManager ?: return null
        val metadata = printer.metadata
        val requiredVendorId = intOrNull(metadata, "usb_vendor_id")
        val requiredProductId = intOrNull(metadata, "usb_product_id")
        val requiredDeviceId = intOrNull(metadata, "usb_device_id")
        val requestedDeviceName = metadata.optString("usb_device_name", "").trim()
        val requestedSerial = metadata.optString("usb_serial_number", metadata.optString("usb_serial", "")).trim()
        val requestedIndex = intOrNull(metadata, "usb_device_index") ?: intOrNull(metadata, "usb_slot")
        val hasExplicitPhysicalSelector =
            requiredVendorId != null ||
                requiredProductId != null ||
                requiredDeviceId != null ||
                requestedDeviceName.isNotEmpty() ||
                requestedSerial.isNotEmpty() ||
                requestedIndex != null
        val allowGenericWritableEndpoint = PrinterSelectionPolicy.usbMayUseGenericWritableEndpoint(hasExplicitPhysicalSelector)

        val candidates = manager.deviceList.values
            .asSequence()
            .filter { device -> requiredVendorId == null || device.vendorId == requiredVendorId }
            .filter { device -> requiredProductId == null || device.productId == requiredProductId }
            .filter { device -> requiredDeviceId == null || device.deviceId == requiredDeviceId }
            .mapNotNull { device -> findPrintableUsbTarget(device, allowGenericWritableEndpoint) }
            .sortedWith(compareBy<UsbTarget>({ it.device.vendorId }, { it.device.productId }, { it.device.deviceName }, { it.device.deviceId }))
            .toList()

        if (candidates.isEmpty()) return null

        if (requestedDeviceName.isNotEmpty()) {
            return candidates.firstOrNull { it.device.deviceName == requestedDeviceName }
                ?: throw NativePrintException("usb_printer_not_found", true, "Configured USB device path is not connected")
        }

        if (requestedSerial.isNotEmpty()) {
            val serialMatch = candidates.firstOrNull { safeUsbSerial(manager, it.device)?.equals(requestedSerial, ignoreCase = true) == true }
            return serialMatch
                ?: throw NativePrintException("usb_printer_not_found", true, "Configured USB serial number is not connected or permission has not been granted")
        }

        if (requestedIndex != null) {
            val normalizedIndex = if (requestedIndex > 0) requestedIndex - 1 else requestedIndex
            return candidates.getOrNull(normalizedIndex)
                ?: throw NativePrintException("usb_printer_not_found", true, "Configured USB slot is outside the connected printer range")
        }

        val savedBinding = readUsbBinding(printer.id)
        if (savedBinding != null) {
            val bound = candidates.firstOrNull { target -> bindingMatches(manager, savedBinding, target.device) }
            if (bound != null) return bound
            clearUsbBinding(printer.id)
        }

        if (candidates.size == 1) {
            persistUsbBinding(printer.id, candidates.first().device)
            return candidates.first()
        }

        val claimedBindings = usbBindingPrefs.all
            .filterKeys { it.startsWith(USB_BINDING_KEY_PREFIX) && it != usbBindingKey(printer.id) }
            .values
            .mapNotNull { it as? String }
            .toSet()

        val unclaimed = candidates.firstOrNull { target ->
            claimedBindings.none { binding -> bindingMatches(manager, binding, target.device) }
        }
        if (unclaimed != null) {
            persistUsbBinding(printer.id, unclaimed.device)
            return unclaimed
        }

        throw NativePrintException(
            "usb_printer_ambiguous",
            false,
            "Multiple USB printer candidates are connected and all physical targets are already bound. Configure usb_device_name, usb_serial_number, usb_vendor_id/product_id, or usb_slot for the intended printer."
        )
    }

    private fun findPrintableUsbTarget(device: UsbDevice, allowGenericWritableEndpoint: Boolean): UsbTarget? {
        var fallback: UsbTarget? = null
        for (interfaceIndex in 0 until device.interfaceCount) {
            val usbInterface = device.getInterface(interfaceIndex)
            for (endpointIndex in 0 until usbInterface.endpointCount) {
                val endpoint = usbInterface.getEndpoint(endpointIndex)
                if (endpoint.direction != UsbConstants.USB_DIR_OUT) continue
                if (endpoint.type != UsbConstants.USB_ENDPOINT_XFER_BULK && endpoint.type != UsbConstants.USB_ENDPOINT_XFER_INT) continue
                val candidate = UsbTarget(device, usbInterface, endpoint)
                if (usbInterface.interfaceClass == UsbConstants.USB_CLASS_PRINTER) return candidate
                if (fallback == null) fallback = candidate
            }
        }

        val genericTarget = fallback ?: return null
        val manufacturerName = runCatching { device.manufacturerName?.trim() }.getOrNull()
        val productName = runCatching { device.productName?.trim() }.getOrNull()
        val safeAutoSelect = PrinterSelectionPolicy.usbMayAutoSelect(
            hasPrinterClassInterface = false,
            manufacturerName = manufacturerName,
            productName = productName
        )
        return if (safeAutoSelect || allowGenericWritableEndpoint) genericTarget else null
    }

    private fun usbBindingKey(printerId: String) = "$USB_BINDING_KEY_PREFIX${printerId.ifBlank { "unknown" }}"

    private fun readUsbBinding(printerId: String): String? =
        usbBindingPrefs.getString(usbBindingKey(printerId), null)?.trim()?.takeIf { it.isNotEmpty() }

    private fun clearUsbBinding(printerId: String) {
        usbBindingPrefs.edit().remove(usbBindingKey(printerId)).apply()
    }

    private fun persistUsbBinding(printerId: String, device: UsbDevice) {
        if (printerId.isBlank()) return
        val manager = usbManager
        val serial = if (manager != null) safeUsbSerial(manager, device) else null
        val binding = if (!serial.isNullOrBlank()) {
            "serial:${device.vendorId}:${device.productId}:$serial"
        } else {
            "path:${device.vendorId}:${device.productId}:${device.deviceName}"
        }
        usbBindingPrefs.edit().putString(usbBindingKey(printer.id), binding).apply()
    }

    private fun bindingMatches(manager: UsbManager, binding: String, device: UsbDevice): Boolean {
        if (binding.startsWith("serial:")) {
            val parts = binding.split(":", limit = 4)
            if (parts.size != 4) return false
            val vendorId = parts[1].toIntOrNull() ?: return false
            val productId = parts[2].toIntOrNull() ?: return false
            val serial = parts[3]
            return device.vendorId == vendorId && device.productId == productId && safeUsbSerial(manager, device)?.equals(serial, ignoreCase = true) == true
        }
        if (binding.startsWith("path:")) {
            val parts = binding.split(":", limit = 4)
            if (parts.size != 4) return false
            val vendorId = parts[1].toIntOrNull() ?: return false
            val productId = parts[2].toIntOrNull() ?: return false
            val deviceName = parts[3]
            return device.vendorId == vendorId && device.productId == productId && device.deviceName == deviceName
        }
        return false
    }

    private fun safeUsbSerial(manager: UsbManager, device: UsbDevice): String? {
        if (!manager.hasPermission(device)) return null
        return runCatching { device.serialNumber?.trim()?.takeIf { it.isNotEmpty() } }.getOrNull()
    }

    @Suppress("DEPRECATION")
    private fun printBluetooth(printer: NativePrinterProfile, payload: ByteArray): NativePrintResult {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && ContextCompat.checkSelfPermission(appContext, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            throw NativePrintException("bluetooth_permission_required", true, "Bluetooth permission is required on this POS device")
        }

        val adapter = bluetoothManager?.adapter ?: throw NativePrintException("bluetooth_not_supported", false, "Bluetooth is not available")
        if (!adapter.isEnabled) throw NativePrintException("bluetooth_disabled", true, "Bluetooth is turned off")

        val metadata = printer.metadata
        val address = metadata.optString("bluetooth_address", metadata.optString("bluetooth_mac", "")).trim()
        val preferredName = metadata.optString("bluetooth_name", "").trim()
        val bonded = adapter.bondedDevices.orEmpty().toList()
        val target = when {
            address.isNotBlank() -> bonded.firstOrNull { it.address.equals(address, ignoreCase = true) }
            preferredName.isNotBlank() -> selectBondedBluetoothByName(bonded, preferredName)
            else -> {
                val printerCandidates = bonded.filter { device -> PrinterSelectionPolicy.bluetoothMayAutoSelect(runCatching { device.name }.getOrNull()) }
                when (printerCandidates.size) {
                    0 -> null
                    1 -> printerCandidates.first()
                    else -> throw NativePrintException("bluetooth_printer_ambiguous", false, "Multiple paired Bluetooth printer candidates are available. Configure bluetooth_address or bluetooth_name explicitly.")
                }
            }
        } ?: throw NativePrintException("bluetooth_printer_not_paired", true, "Bluetooth printer is not paired or the configured name/address does not match")

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || ContextCompat.checkSelfPermission(appContext, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED) {
            runCatching { adapter.cancelDiscovery() }
        }

        try {
            target.createRfcommSocketToServiceRecord(SPP_UUID).use { socket ->
                socket.connect()
                socket.outputStream.use { output ->
                    output.write(payload)
                    output.flush()
                }
            }
            return NativePrintResult(payload.size, "bluetooth", "android-bt:${target.address}")
        } catch (error: Throwable) {
            throw NativePrintException("bluetooth_print_failed", true, error.message ?: "Bluetooth print failed", error)
        }
    }

    @Suppress("DEPRECATION")
    private fun selectBondedBluetoothByName(bonded: List<android.bluetooth.BluetoothDevice>, preferredName: String): android.bluetooth.BluetoothDevice? {
        val exactMatches = bonded.filter { device -> runCatching { device.name?.equals(preferredName, ignoreCase = true) == true }.getOrDefault(false) }
        if (exactMatches.size == 1) return exactMatches.first()
        if (exactMatches.size > 1) throw NativePrintException("bluetooth_printer_ambiguous", false, "Multiple paired Bluetooth devices have the configured printer name. Configure bluetooth_address explicitly.")

        val partialMatches = bonded.filter { device -> runCatching { device.name?.contains(preferredName, ignoreCase = true) == true }.getOrDefault(false) }
        return when (partialMatches.size) {
            0 -> null
            1 -> partialMatches.first()
            else -> throw NativePrintException("bluetooth_printer_ambiguous", false, "Multiple paired Bluetooth devices match the configured printer name. Configure bluetooth_address explicitly.")
        }
    }

    private fun intOrNull(json: JSONObject, key: String): Int? {
        if (!json.has(key) || json.isNull(key)) return null
        val value = json.optInt(key, Int.MIN_VALUE)
        return value.takeIf { it != Int.MIN_VALUE }
    }

    companion object {
        private const val USB_PERMISSION_ACTION = "com.cpipos.pos.USB_PRINTER_PERMISSION"
        private const val USB_BINDING_PREFS = "cpipos_usb_printer_binding_v2"
        private const val USB_BINDING_KEY_PREFIX = "profile:"
        private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }
}
