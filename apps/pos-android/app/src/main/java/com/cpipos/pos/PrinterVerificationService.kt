package com.cpipos.pos

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.InetSocketAddress
import java.net.Socket

/**
 * Targeted, fail-closed printer verification for the Android POS runtime.
 *
 * Probe mode never writes printer bytes. Verification print mode uses an exact canonical
 * fingerprint, a short-lived one-time command and the existing native transport. It never
 * creates or rewrites a printer assignment. Bluetooth UUID advertisement is supporting
 * evidence only: an exact bonded target with printer evidence may still be verified because
 * real embedded printers can omit advertised SPP UUIDs while accepting RFCOMM SPP.
 */
internal class PrinterVerificationService(context: Context) {
    private val appContext = context.applicationContext
    private val inventory = PrinterCapabilityInventory(appContext)
    private val transport = NativePrintTransport(appContext)
    private val prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun execute(command: JSONObject, nowMs: Long = System.currentTimeMillis()): JSONObject {
        val commandId = command.optString("id", "").trim()
        val envelope = command.optJSONObject("printer_verification")
            ?: return failure(commandId, null, null, "verification_envelope_missing", false)
        val mode = PrinterVerificationPolicy.Mode.parse(envelope.optString("mode", ""))
            ?: return failure(commandId, null, envelope.optString("target_fingerprint", null), "verification_mode_invalid", false)
        val targetFingerprint = envelope.optString("target_fingerprint", "").trim().lowercase()
        val request = PrinterVerificationPolicy.Request(
            commandId = commandId,
            mode = mode,
            targetFingerprint = targetFingerprint,
            issuedAtMs = envelope.optLong("issued_at_ms", 0L),
            expiresAtMs = envelope.optLong("expires_at_ms", 0L),
            operatorConfirmed = envelope.optBoolean("operator_confirmed", false)
        )
        val validation = PrinterVerificationPolicy.validate(request, nowMs)
        if (!validation.allowed) {
            return failure(commandId, mode, targetFingerprint, validation.code, false)
        }
        val target = PrinterVerificationTarget.parse(targetFingerprint)
            ?: return failure(commandId, mode, targetFingerprint, "verification_target_invalid", false)

        if (mode == PrinterVerificationPolicy.Mode.VERIFICATION_PRINT && isConsumed(commandId)) {
            return failure(commandId, mode, targetFingerprint, "verification_command_already_consumed", false)
                .put("consumed", true)
        }

        val resolution = resolve(target)
        if (mode == PrinterVerificationPolicy.Mode.PROBE) {
            return JSONObject()
                .put("ok", true)
                .put("mode", mode.wireValue)
                .put("command_id", commandId)
                .put("target_fingerprint", target.fingerprint)
                .put("ready", resolution.ready)
                .put("code", resolution.code)
                .put("retryable", resolution.retryable)
                .put("probe", resolution.details)
        }

        // USB verification is allowed to enter the native transport once for the exact target
        // even when permission is missing. NativePrintTransport then shows Android's permission
        // dialog and returns usb_permission_required without writing bytes. The same command ID
        // may be retried after permission is granted because it is consumed only after success.
        val mayRequestExactUsbPermission =
            target is PrinterVerificationTarget.Usb &&
                resolution.profile != null &&
                resolution.code == "usb_permission_required"
        if (!resolution.ready && !mayRequestExactUsbPermission) {
            return failure(commandId, mode, target.fingerprint, resolution.code, resolution.retryable)
                .put("ready", false)
                .put("probe", resolution.details)
        }

        val profile = resolution.profile
            ?: return failure(commandId, mode, target.fingerprint, "verification_target_not_resolved", true)
        val job = NativePrintJob(
            id = "verification:$commandId",
            attemptId = "verification:$commandId",
            payloadText = buildVerificationText(target.fingerprint),
            metadata = JSONObject()
                .put("command", "printer_verification")
                .put("auto_cut", false),
            printer = profile
        )

        return try {
            val printed = transport.print(job)
            markConsumed(commandId)
            JSONObject()
                .put("ok", true)
                .put("mode", mode.wireValue)
                .put("command_id", commandId)
                .put("target_fingerprint", target.fingerprint)
                .put("ready", true)
                .put("printed", true)
                .put("consumed", true)
                .put("code", "verification_printed")
                .put("retryable", false)
                .put("transport", printed.transport)
                .put("bytes_sent", printed.bytesSent)
                .put("provider_job_id", printed.providerJobId)
                .put("probe", resolution.details)
        } catch (error: NativePrintException) {
            failure(commandId, mode, target.fingerprint, error.code, error.retryable)
                .put("ready", resolution.ready)
                .put("printed", false)
                .put("consumed", false)
                .put("message", error.message?.take(240))
                .put("probe", resolution.details)
        } catch (error: Throwable) {
            failure(commandId, mode, target.fingerprint, "verification_print_failed", true)
                .put("ready", resolution.ready)
                .put("printed", false)
                .put("consumed", false)
                .put("message", error.message?.take(240))
                .put("probe", resolution.details)
        }
    }

    private data class Resolution(
        val ready: Boolean,
        val code: String,
        val retryable: Boolean,
        val details: JSONObject,
        val profile: NativePrinterProfile?
    )

    private fun resolve(target: PrinterVerificationTarget): Resolution = when (target) {
        is PrinterVerificationTarget.Usb -> resolveUsb(target)
        is PrinterVerificationTarget.Bluetooth -> resolveBluetooth(target)
        is PrinterVerificationTarget.Lan -> resolveLan(target)
    }

    private fun resolveUsb(target: PrinterVerificationTarget.Usb): Resolution {
        val usb = inventory.snapshot().optJSONObject("usb") ?: JSONObject()
        val devices = usb.optJSONArray("devices") ?: JSONArray()
        val matches = mutableListOf<JSONObject>()
        for (index in 0 until devices.length()) {
            val row = devices.optJSONObject(index) ?: continue
            if (usbRowMatchesFingerprint(row, target.fingerprint)) matches += row
        }
        if (matches.size > 1) {
            return Resolution(
                ready = false,
                code = "usb_printer_ambiguous",
                retryable = false,
                details = JSONObject().put("match_count", matches.size),
                profile = null
            )
        }
        val row = matches.firstOrNull()
            ?: return Resolution(
                ready = false,
                code = "usb_printer_not_found",
                retryable = true,
                details = JSONObject().put("match_count", 0),
                profile = null
            )

        val hasPermission = row.optBoolean("has_permission", false)
        val writable = row.optBoolean("native_transport_candidate", false)
        val metadata = JSONObject()
            .put("transport_mode", "usb")
            .put("usb_vendor_id", row.optInt("vendor_id", target.vendorId))
            .put("usb_product_id", row.optInt("product_id", target.productId))
            .put("usb_device_id", row.optInt("device_id"))
            .put("usb_device_name", row.optString("device_name", ""))
            .put("physical_fingerprint", target.fingerprint)
        row.optString("serial_number", "").trim().takeIf { it.isNotEmpty() }?.let {
            metadata.put("usb_serial_number", it)
        }
        val profile = NativePrinterProfile(
            id = "",
            name = "CpIPOS verification USB target",
            connectionType = "LOCAL_BRIDGE",
            ipAddress = null,
            port = null,
            metadata = metadata
        )
        val code = when {
            !writable -> "usb_not_printable"
            !hasPermission -> "usb_permission_required"
            else -> "ready"
        }
        return Resolution(
            ready = writable && hasPermission,
            code = code,
            retryable = code == "usb_permission_required",
            details = JSONObject()
                .put("found", true)
                .put("has_permission", hasPermission)
                .put("native_transport_candidate", writable)
                .put("safe_autobind_candidate", row.optBoolean("safe_autobind_candidate", false))
                .put("device_id", row.optInt("device_id"))
                .put("device_name", row.optString("device_name", null))
                .put("manufacturer_name", row.optString("manufacturer_name", null))
                .put("product_name", row.optString("product_name", null)),
            profile = profile
        )
    }

    private fun usbRowMatchesFingerprint(row: JSONObject, expected: String): Boolean {
        val vendorId = row.optInt("vendor_id", -1)
        val productId = row.optInt("product_id", -1)
        if (vendorId < 0 || productId < 0) return false
        val serial = row.optString("serial_number", "").trim().takeIf { it.isNotEmpty() }
        val deviceName = row.optString("device_name", "").trim().takeIf { it.isNotEmpty() }
        val stable = PrinterPhysicalFingerprint.usb(vendorId, productId, serial, deviceName)?.value
        val session = PrinterPhysicalFingerprint.usb(vendorId, productId, null, deviceName)?.value
        return expected == stable || expected == session
    }

    private fun resolveBluetooth(target: PrinterVerificationTarget.Bluetooth): Resolution {
        val bluetooth = inventory.snapshot().optJSONObject("bluetooth") ?: JSONObject()
        val permissionGranted = bluetooth.optBoolean("connect_permission_granted", false)
        val enabled = bluetooth.optBoolean("enabled", false)
        val profile = NativePrinterProfile(
            id = "",
            name = "CpIPOS verification Bluetooth target",
            connectionType = "BLUETOOTH_BRIDGE",
            ipAddress = null,
            port = null,
            metadata = JSONObject()
                .put("transport_mode", "bluetooth")
                .put("bluetooth_address", target.address)
                .put("physical_fingerprint", target.fingerprint)
        )
        if (!permissionGranted) {
            return Resolution(
                ready = false,
                code = "bluetooth_permission_required",
                retryable = true,
                details = JSONObject().put("connect_permission_granted", false),
                profile = profile
            )
        }

        val bonded = bluetooth.optJSONArray("bonded_devices") ?: JSONArray()
        var match: JSONObject? = null
        for (index in 0 until bonded.length()) {
            val row = bonded.optJSONObject(index) ?: continue
            if (row.optString("physical_fingerprint", "") == target.fingerprint) {
                if (match != null) {
                    return Resolution(false, "bluetooth_printer_ambiguous", false, JSONObject().put("match_count", 2), null)
                }
                match = row
            }
        }
        val row = match
            ?: return Resolution(
                ready = false,
                code = "bluetooth_printer_not_paired",
                retryable = true,
                details = JSONObject().put("paired", false).put("enabled", enabled),
                profile = profile
            )

        val sppAdvertised = row.optBoolean("spp_uuid_present", false)
        val printerEvidence = row.optBoolean("printer_name_hint", false)
        val exactBondedFallback = !sppAdvertised && printerEvidence
        val ready = enabled && (sppAdvertised || printerEvidence)
        val code = when {
            !enabled -> "bluetooth_disabled"
            !sppAdvertised && !printerEvidence -> "bluetooth_printer_evidence_missing"
            else -> "ready"
        }
        return Resolution(
            ready = ready,
            code = code,
            retryable = code == "bluetooth_disabled",
            details = JSONObject()
                .put("paired", true)
                .put("enabled", enabled)
                .put("spp_uuid_present", sppAdvertised)
                .put("printer_name_hint", printerEvidence)
                .put("exact_bonded_fallback", exactBondedFallback)
                .put("name", row.optString("name", null))
                .put("address", row.optString("address", target.address)),
            profile = profile
        )
    }

    private fun resolveLan(target: PrinterVerificationTarget.Lan): Resolution {
        val reachable = runCatching {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(target.host, target.port), LAN_PROBE_TIMEOUT_MS)
            }
            true
        }.getOrDefault(false)
        return Resolution(
            ready = reachable,
            code = if (reachable) "ready" else "lan_unreachable",
            retryable = !reachable,
            details = JSONObject()
                .put("host", target.host)
                .put("port", target.port)
                .put("reachable", reachable)
                .put("bytes_written", 0),
            profile = NativePrinterProfile(
                id = "",
                name = "CpIPOS verification LAN target",
                connectionType = "NETWORK_ESC_POS",
                ipAddress = target.host,
                port = target.port,
                metadata = JSONObject()
                    .put("transport_mode", "lan")
                    .put("physical_fingerprint", target.fingerprint)
            )
        )
    }

    private fun failure(
        commandId: String,
        mode: PrinterVerificationPolicy.Mode?,
        fingerprint: String?,
        code: String,
        retryable: Boolean
    ): JSONObject = JSONObject()
        .put("ok", false)
        .put("mode", mode?.wireValue)
        .put("command_id", commandId)
        .put("target_fingerprint", fingerprint)
        .put("code", code)
        .put("retryable", retryable)

    private fun buildVerificationText(fingerprint: String): String = buildString {
        appendLine("CpIPOS PRINTER VERIFICATION")
        appendLine("NO SALE / NO ORDER")
        appendLine("Target: $fingerprint")
        appendLine("One-time hardware test")
    }

    @Synchronized
    private fun isConsumed(commandId: String): Boolean = readConsumedIds().contains(commandId)

    @Synchronized
    private fun markConsumed(commandId: String) {
        val ids = readConsumedIds().filterNot { it == commandId }.toMutableList()
        ids += commandId
        val bounded = ids.takeLast(MAX_CONSUMED_IDS)
        prefs.edit().putString(CONSUMED_KEY, JSONArray(bounded).toString()).apply()
    }

    private fun readConsumedIds(): List<String> {
        val raw = prefs.getString(CONSUMED_KEY, null).orEmpty()
        if (raw.isBlank()) return emptyList()
        return runCatching {
            val values = JSONArray(raw)
            buildList {
                for (index in 0 until values.length()) {
                    values.optString(index, "").trim().takeIf { it.isNotEmpty() }?.let(::add)
                }
            }
        }.getOrDefault(emptyList())
    }

    companion object {
        private const val PREFS_NAME = "cpipos_printer_verification_v1"
        private const val CONSUMED_KEY = "consumed_command_ids"
        private const val MAX_CONSUMED_IDS = 32
        private const val LAN_PROBE_TIMEOUT_MS = 1_800
    }
}
