package com.cpipos.pos

/**
 * Canonical physical identity for printer transports.
 *
 * Fingerprints deliberately exclude POS model, display count and friendly printer names.
 * They are intended to describe the physical endpoint that was actually discovered so
 * existing customer assignments can be preserved across app/runtime upgrades.
 */
internal object PrinterPhysicalFingerprint {
    enum class Stability(val wireValue: String) {
        STABLE("stable"),
        SESSION_SCOPED("session_scoped"),
        ENDPOINT_SCOPED("endpoint_scoped")
    }

    data class Value(
        val value: String,
        val stability: Stability
    )

    fun usb(
        vendorId: Int,
        productId: Int,
        serialNumber: String?,
        deviceName: String?
    ): Value? {
        if (vendorId !in USB_ID_RANGE || productId !in USB_ID_RANGE) return null

        val prefix = "usb:vid${vendorId.toString(16).padStart(4, '0')}:pid${productId.toString(16).padStart(4, '0')}"
        val serial = normalizeToken(serialNumber)
        if (serial != null) {
            return Value(
                value = "$prefix:serial:$serial",
                stability = Stability.STABLE
            )
        }

        val path = normalizeToken(deviceName)
        if (path != null) {
            return Value(
                value = "$prefix:path:$path",
                stability = Stability.SESSION_SCOPED
            )
        }

        // VID/PID alone cannot distinguish two identical printers, so fail closed.
        return null
    }

    fun bluetooth(address: String?): Value? {
        val normalized = address.orEmpty()
            .trim()
            .replace(":", "")
            .replace("-", "")
            .lowercase()
        if (!BLUETOOTH_MAC.matches(normalized)) return null
        return Value(
            value = "bluetooth:mac:$normalized",
            stability = Stability.STABLE
        )
    }

    fun lan(host: String?, port: Int?): Value? {
        val normalizedHost = host.orEmpty().trim().lowercase().takeIf { it.isNotEmpty() } ?: return null
        val normalizedPort = port?.takeIf { it in 1..65535 } ?: return null
        return Value(
            value = "lan:host:${normalizeToken(normalizedHost) ?: return null}:port:$normalizedPort",
            stability = Stability.ENDPOINT_SCOPED
        )
    }

    private fun normalizeToken(value: String?): String? {
        val normalized = value.orEmpty().trim().lowercase()
        if (normalized.isEmpty()) return null
        return normalized
            .replace(NON_TOKEN_CHARS, "_")
            .trim('_')
            .takeIf { it.isNotEmpty() }
    }

    private val USB_ID_RANGE = 0..0xffff
    private val BLUETOOTH_MAC = Regex("^[0-9a-f]{12}$")
    private val NON_TOKEN_CHARS = Regex("[^a-z0-9._-]+")
}
