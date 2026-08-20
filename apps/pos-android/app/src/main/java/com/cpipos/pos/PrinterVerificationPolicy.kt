package com.cpipos.pos

/**
 * Fail-closed policy for targeted printer probes and one-time verification prints.
 *
 * Phase B never creates/replaces an assignment. Verification print requires an explicit
 * operator confirmation and a short-lived command envelope.
 */
internal object PrinterVerificationPolicy {
    enum class Mode(val wireValue: String) {
        PROBE("probe"),
        VERIFICATION_PRINT("verification_print");

        companion object {
            fun parse(value: String?): Mode? = values().firstOrNull {
                it.wireValue == value.orEmpty().trim().lowercase()
            }
        }
    }

    data class Request(
        val commandId: String,
        val mode: Mode,
        val targetFingerprint: String,
        val issuedAtMs: Long,
        val expiresAtMs: Long,
        val operatorConfirmed: Boolean
    )

    data class Validation(
        val allowed: Boolean,
        val code: String
    )

    fun validate(request: Request, nowMs: Long): Validation {
        if (!COMMAND_ID.matches(request.commandId.trim())) {
            return Validation(false, "verification_command_id_invalid")
        }
        if (PrinterVerificationTarget.parse(request.targetFingerprint) == null) {
            return Validation(false, "verification_target_invalid")
        }
        if (request.issuedAtMs <= 0L || request.expiresAtMs <= request.issuedAtMs) {
            return Validation(false, "verification_window_invalid")
        }
        if (request.issuedAtMs > nowMs + MAX_FUTURE_CLOCK_SKEW_MS) {
            return Validation(false, "verification_not_yet_valid")
        }
        if (nowMs >= request.expiresAtMs) {
            return Validation(false, "verification_command_expired")
        }

        val maxWindow = when (request.mode) {
            Mode.PROBE -> MAX_PROBE_WINDOW_MS
            Mode.VERIFICATION_PRINT -> MAX_PRINT_WINDOW_MS
        }
        if (request.expiresAtMs - request.issuedAtMs > maxWindow) {
            return Validation(false, "verification_window_too_long")
        }
        if (request.mode == Mode.VERIFICATION_PRINT && !request.operatorConfirmed) {
            return Validation(false, "verification_operator_confirmation_required")
        }

        return Validation(true, "ok")
    }

    private val COMMAND_ID = Regex("^[a-zA-Z0-9._:-]{1,120}$")
    private const val MAX_FUTURE_CLOCK_SKEW_MS = 30_000L
    private const val MAX_PROBE_WINDOW_MS = 30 * 60_000L
    private const val MAX_PRINT_WINDOW_MS = 5 * 60_000L
}
