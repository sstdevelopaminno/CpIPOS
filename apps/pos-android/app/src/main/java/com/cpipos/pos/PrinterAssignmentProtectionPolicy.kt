package com.cpipos.pos

/**
 * Pure guard for future auto-setup reconciliation.
 *
 * Phase A does not write printer assignments. This policy establishes the invariant that
 * discovery may confirm an existing physical printer, but a different or missing endpoint
 * must never silently replace the customer's current routing.
 */
internal object PrinterAssignmentProtectionPolicy {
    enum class Decision(val wireValue: String) {
        NO_ACTION("no_action"),
        USE_DISCOVERED("use_discovered"),
        KEEP_EXISTING("keep_existing"),
        KEEP_EXISTING_OFFLINE("keep_existing_offline"),
        REQUIRE_CONFIRMATION("require_confirmation")
    }

    fun decide(
        existingFingerprint: String?,
        discoveredFingerprint: String?
    ): Decision {
        val existing = normalize(existingFingerprint)
        val discovered = normalize(discoveredFingerprint)

        return when {
            existing == null && discovered == null -> Decision.NO_ACTION
            existing == null -> Decision.USE_DISCOVERED
            discovered == null -> Decision.KEEP_EXISTING_OFFLINE
            existing == discovered -> Decision.KEEP_EXISTING
            else -> Decision.REQUIRE_CONFIRMATION
        }
    }

    private fun normalize(value: String?): String? =
        value?.trim()?.lowercase()?.takeIf { it.isNotEmpty() }
}
