package com.cpipos.pos

/**
 * Parser for the canonical physical printer fingerprints introduced by Phase A.
 *
 * Verification never resolves a printer from a friendly name or POS model. The caller must
 * provide an exact physical fingerprint and this parser fails closed on malformed values.
 */
internal sealed class PrinterVerificationTarget(open val fingerprint: String) {
    data class Usb(
        override val fingerprint: String,
        val vendorId: Int,
        val productId: Int,
        val identityKind: String,
        val identityToken: String
    ) : PrinterVerificationTarget(fingerprint)

    data class Bluetooth(
        override val fingerprint: String,
        val address: String
    ) : PrinterVerificationTarget(fingerprint)

    data class Lan(
        override val fingerprint: String,
        val host: String,
        val port: Int
    ) : PrinterVerificationTarget(fingerprint)

    companion object {
        private val USB = Regex("^usb:vid([0-9a-f]{4}):pid([0-9a-f]{4}):(serial|path):([a-z0-9._-]+)$")
        private val BLUETOOTH = Regex("^bluetooth:mac:([0-9a-f]{12})$")
        private val LAN = Regex("^lan:host:([a-z0-9._-]+):port:([0-9]{1,5})$")

        fun parse(value: String?): PrinterVerificationTarget? {
            val normalized = value.orEmpty().trim().lowercase()
            if (normalized.isEmpty() || normalized.length > 240) return null

            USB.matchEntire(normalized)?.let { match ->
                val vendorId = match.groupValues[1].toIntOrNull(16) ?: return null
                val productId = match.groupValues[2].toIntOrNull(16) ?: return null
                return Usb(
                    fingerprint = normalized,
                    vendorId = vendorId,
                    productId = productId,
                    identityKind = match.groupValues[3],
                    identityToken = match.groupValues[4]
                )
            }

            BLUETOOTH.matchEntire(normalized)?.let { match ->
                val compact = match.groupValues[1]
                val address = compact.chunked(2).joinToString(":").uppercase()
                return Bluetooth(normalized, address)
            }

            LAN.matchEntire(normalized)?.let { match ->
                val port = match.groupValues[2].toIntOrNull()?.takeIf { it in 1..65535 } ?: return null
                return Lan(
                    fingerprint = normalized,
                    host = match.groupValues[1],
                    port = port
                )
            }

            return null
        }
    }
}
