package com.cpipos.pos

internal object PrinterHardwareClassifier {
    private val printerNamePattern = Regex(
        pattern = "printer|esc.?pos|thermal|receipt|kitchen|pos[-_ ]?58|pos[-_ ]?80|58mm|80mm|glprinter|xprinter|xp-?58|xp-?80|inner printer",
        option = RegexOption.IGNORE_CASE
    )

    fun hasPrinterNameHint(vararg values: String?): Boolean = values
        .filterNotNull()
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .any { printerNamePattern.containsMatchIn(it) }

    fun usbFingerprint(vendorId: Int, productId: Int, serialNumber: String?, deviceName: String?): Fingerprint {
        val serial = serialNumber?.trim()?.takeIf { it.isNotEmpty() }
        if (serial != null) {
            return Fingerprint(
                value = "usb:vid${vendorId.hex4()}:pid${productId.hex4()}:serial:${serial.lowercase()}",
                stability = "stable"
            )
        }
        val path = deviceName?.trim()?.takeIf { it.isNotEmpty() }?.sanitizeFingerprintPart() ?: "unknown"
        return Fingerprint(
            value = "usb:vid${vendorId.hex4()}:pid${productId.hex4()}:path:$path",
            stability = "session_scoped"
        )
    }

    fun bluetoothFingerprint(address: String?): Fingerprint? {
        val clean = address?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        return Fingerprint(
            value = "bluetooth:mac:${clean.replace(":", "").lowercase()}",
            stability = "stable"
        )
    }

    fun usbSafeAutobindCandidate(usbPrinterClass: Boolean, printerNameHint: Boolean): Boolean =
        usbPrinterClass || printerNameHint

    fun bluetoothPrinterHint(name: String?, sppUuidPresent: Boolean): Boolean =
        hasPrinterNameHint(name) || (sppUuidPresent && hasPrinterNameHint(name))

    private fun Int.hex4(): String = toString(16).padStart(4, '0').lowercase()

    private fun String.sanitizeFingerprintPart(): String = lowercase()
        .replace(Regex("[^a-z0-9]+"), "_")
        .trim('_')
        .ifEmpty { "unknown" }

    data class Fingerprint(val value: String, val stability: String)
}
