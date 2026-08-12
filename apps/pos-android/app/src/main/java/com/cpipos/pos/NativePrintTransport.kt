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
import android.text.Html
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
    val providerJobId: String
)

internal class NativePrintException(
    val code: String,
    val retryable: Boolean,
    message: String,
    cause: Throwable? = null
) : Exception(message, cause)

internal class NativePrintTransport(context: Context) {
    private val appContext = context.applicationContext
    private val usbManager = appContext.getSystemService(UsbManager::class.java)
    private val bluetoothManager = appContext.getSystemService(BluetoothManager::class.java)

    fun print(job: NativePrintJob): NativePrintResult {
        val mode = job.printer.metadata.optString("transport_mode", "").trim().lowercase()
        val payload = buildPayload(job)
        return when {
            job.printer.connectionType == "NETWORK_ESC_POS" || mode == "lan" -> printLan(job.printer, payload)
            job.printer.connectionType == "LOCAL_BRIDGE" || mode == "usb" -> printUsb(job.printer, payload)
            job.printer.connectionType == "BLUETOOTH_BRIDGE" || mode == "bluetooth" -> printBluetooth(job.printer, payload)
            else -> throw NativePrintException(
                "unsupported_transport",
                false,
                "Unsupported printer transport: ${job.printer.connectionType}"
            )
        }
    }

    private fun buildPayload(job: NativePrintJob): ByteArray {
        val command = job.metadata.optString("command", "").trim().lowercase()
        if (command == "open_cash_drawer" || job.payloadText.trim() == "OPEN_CASH_DRAWER") {
            val pin = job.metadata.optInt("drawer_kick_pin", 0).coerceIn(0, 1)
            val onMs = job.metadata.optInt("drawer_pulse_on_ms", 50).coerceIn(2, 510)
            val offMs = job.metadata.optInt("drawer_pulse_off_ms", 250).coerceIn(2, 510)
            return byteArrayOf(
                0x1B,
                0x70,
                pin.toByte(),
                (onMs / 2).coerceIn(1, 255).toByte(),
                (offMs / 2).coerceIn(1, 255).toByte()
            )
        }

        val html = job.metadata.optString("payload_html", "").trim()
        val printableText = if (html.isNotEmpty()) {
            Html.fromHtml(html, Html.FROM_HTML_MODE_LEGACY).toString()
                .replace("\u00a0", " ")
                .replace(Regex("\n{3,}"), "\n\n")
                .trim()
                .ifEmpty { job.payloadText }
        } else {
            job.payloadText
        }

        val profileMetadata = job.printer.metadata
        val charsetName = profileMetadata.optString("escpos_charset", "windows-874").trim().ifEmpty { "windows-874" }
        val charset = runCatching { Charset.forName(charsetName) }.getOrElse { Charsets.UTF_8 }
        val codeTable = profileMetadata.optInt("escpos_code_table", 26).coerceIn(0, 255)
        val feedLines = profileMetadata.optInt("feed_lines", 3).coerceIn(1, 8)
        val autoCut = profileMetadata.optBoolean("auto_cut", false)

        val output = ByteArrayOutputStream()
        output.write(byteArrayOf(0x1B, 0x40))
        output.write(byteArrayOf(0x1B, 0x74, codeTable.toByte()))
        output.write(printableText.replace("\r\n", "\n").toByteArray(charset))
        repeat(feedLines) { output.write('\n'.code) }
        if (autoCut) output.write(byteArrayOf(0x1D, 0x56, 0x00))
        return output.toByteArray()
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
        val target = findUsbTarget(printer.metadata)
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

    private fun findUsbTarget(metadata: JSONObject): UsbTarget? {
        val manager = usbManager ?: return null
        val requiredVendorId = intOrNull(metadata, "usb_vendor_id")
        val requiredProductId = intOrNull(metadata, "usb_product_id")

        for (device in manager.deviceList.values) {
            if (requiredVendorId != null && device.vendorId != requiredVendorId) continue
            if (requiredProductId != null && device.productId != requiredProductId) continue

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
            if (fallback != null) return fallback
        }
        return null
    }

    @Suppress("DEPRECATION")
    private fun printBluetooth(printer: NativePrinterProfile, payload: ByteArray): NativePrintResult {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            ContextCompat.checkSelfPermission(appContext, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
        ) {
            throw NativePrintException(
                "bluetooth_permission_required",
                true,
                "Bluetooth permission is required on this POS device"
            )
        }

        val adapter = bluetoothManager?.adapter
            ?: throw NativePrintException("bluetooth_not_supported", false, "Bluetooth is not available")
        if (!adapter.isEnabled) throw NativePrintException("bluetooth_disabled", true, "Bluetooth is turned off")

        val metadata = printer.metadata
        val address = metadata.optString("bluetooth_address", metadata.optString("bluetooth_mac", "")).trim()
        val preferredName = metadata.optString("bluetooth_name", "").trim()
        val bonded = adapter.bondedDevices.orEmpty()
        val target = when {
            address.isNotBlank() -> bonded.firstOrNull { it.address.equals(address, ignoreCase = true) }
            preferredName.isNotBlank() -> bonded.firstOrNull { it.name?.equals(preferredName, ignoreCase = true) == true }
                ?: bonded.firstOrNull { it.name?.contains(preferredName, ignoreCase = true) == true }
            bonded.size == 1 -> bonded.first()
            else -> null
        } ?: throw NativePrintException(
            "bluetooth_printer_not_paired",
            true,
            "Bluetooth printer is not paired or the configured name/address does not match"
        )

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            ContextCompat.checkSelfPermission(appContext, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
        ) {
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

    private fun intOrNull(json: JSONObject, key: String): Int? {
        if (!json.has(key) || json.isNull(key)) return null
        val value = json.optInt(key, Int.MIN_VALUE)
        return value.takeIf { it != Int.MIN_VALUE }
    }

    companion object {
        private const val USB_PERMISSION_ACTION = "com.cpipos.pos.USB_PRINTER_PERMISSION"
        private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }
}
