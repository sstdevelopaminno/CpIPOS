package com.cpipos.pos

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/**
 * Capability-gated Full MDM transport executor.
 *
 * Phase 2A intentionally advertises only commands implemented safely by this build:
 * diagnostics_ping and sync_policy. Device-wide lock/unlock/app-management capabilities
 * are NOT advertised yet, so the server-side eligibility policy cannot queue them to this
 * runtime until their Device Owner executors are implemented and validated separately.
 */
class FullMdmAgent(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun snapshot(): JSONObject {
        val enabled = BuildConfig.VERSION_NAME == FULL_MDM_VERSION
        val capabilities = JSONArray()
        if (enabled) {
            capabilities.put("mdm_core")
            capabilities.put("policy_sync")
        }

        return JSONObject()
            .put("schema_version", if (enabled) 1 else 0)
            .put("app_flavor", "web-production")
            .put("native_generation", "1.0")
            .put("is_device_owner", isDeviceOwner())
            .put("capabilities", capabilities)
            .put("policy_generation", prefs.getString(POLICY_GENERATION_KEY, null))
    }

    fun pendingResults(): JSONArray = parseArray(prefs.getString(PENDING_RESULTS_KEY, null))

    /** Returns true when at least one new result was produced and should be heartbeated promptly. */
    fun applyResponse(data: JSONObject?): Boolean {
        if (data == null) return false
        clearAcknowledgedResults(data.optJSONObject("full_mdm")?.optJSONArray("acknowledged_result_ids"))

        val commands = data.optJSONArray("full_mdm_commands") ?: return false
        var produced = false
        for (index in 0 until commands.length()) {
            val command = commands.optJSONObject(index) ?: continue
            val commandId = command.optString("id", "").trim()
            val commandType = command.optString("command_type", "").trim().lowercase()
            if (!UUID_PATTERN.matches(commandId) || commandType.isBlank()) continue
            if (hasExecuted(commandId)) continue

            val result = execute(commandType, command.optJSONObject("payload") ?: JSONObject())
            appendResult(commandId, result.first, result.second)
            rememberExecuted(commandId)
            produced = true
        }
        return produced
    }

    private fun execute(commandType: String, payload: JSONObject): Pair<String, JSONObject> {
        if (BuildConfig.VERSION_NAME != FULL_MDM_VERSION) {
            return "failed" to JSONObject()
                .put("ok", false)
                .put("code", "full_mdm_version_not_eligible")
                .put("app_version", BuildConfig.VERSION_NAME)
        }

        return when (commandType) {
            "diagnostics_ping" -> "succeeded" to JSONObject()
                .put("ok", true)
                .put("action", "diagnostics_ping")
                .put("app_version", BuildConfig.VERSION_NAME)
                .put("sdk_int", Build.VERSION.SDK_INT)
                .put("device_owner", isDeviceOwner())
                .put("executed_at_ms", System.currentTimeMillis())

            "sync_policy" -> {
                val generation = when {
                    payload.has("policy_generation") -> payload.opt("policy_generation")?.toString()?.take(120)
                    payload.has("generation") -> payload.opt("generation")?.toString()?.take(120)
                    else -> null
                }
                if (!generation.isNullOrBlank()) {
                    prefs.edit().putString(POLICY_GENERATION_KEY, generation).apply()
                }
                "succeeded" to JSONObject()
                    .put("ok", true)
                    .put("action", "sync_policy")
                    .put("policy_generation", generation ?: JSONObject.NULL)
                    .put("executed_at_ms", System.currentTimeMillis())
            }

            else -> "failed" to JSONObject()
                .put("ok", false)
                .put("code", "full_mdm_command_not_implemented")
                .put("command_type", commandType)
        }
    }

    private fun appendResult(commandId: String, status: String, result: JSONObject) {
        val rows = pendingResults()
        val next = JSONArray()
        for (index in 0 until rows.length()) {
            val row = rows.optJSONObject(index) ?: continue
            if (row.optString("command_id") != commandId) next.put(row)
        }
        next.put(JSONObject().put("command_id", commandId).put("status", status).put("result", result))

        val bounded = JSONArray()
        val start = maxOf(0, next.length() - MAX_PENDING_RESULTS)
        for (index in start until next.length()) bounded.put(next.optJSONObject(index))
        prefs.edit().putString(PENDING_RESULTS_KEY, bounded.toString()).apply()
    }

    private fun clearAcknowledgedResults(ids: JSONArray?) {
        if (ids == null || ids.length() == 0) return
        val acknowledged = mutableSetOf<String>()
        for (index in 0 until ids.length()) {
            ids.optString(index, "").trim().takeIf { it.isNotBlank() }?.let(acknowledged::add)
        }
        if (acknowledged.isEmpty()) return

        val rows = pendingResults()
        val remaining = JSONArray()
        for (index in 0 until rows.length()) {
            val row = rows.optJSONObject(index) ?: continue
            if (row.optString("command_id") !in acknowledged) remaining.put(row)
        }
        prefs.edit().putString(PENDING_RESULTS_KEY, remaining.toString()).apply()
    }

    private fun hasExecuted(commandId: String): Boolean {
        val ids = parseArray(prefs.getString(EXECUTED_IDS_KEY, null))
        for (index in 0 until ids.length()) if (ids.optString(index) == commandId) return true
        return false
    }

    private fun rememberExecuted(commandId: String) {
        val ids = parseArray(prefs.getString(EXECUTED_IDS_KEY, null))
        val next = JSONArray()
        for (index in 0 until ids.length()) {
            val value = ids.optString(index, "").trim()
            if (value.isNotBlank() && value != commandId) next.put(value)
        }
        next.put(commandId)

        val bounded = JSONArray()
        val start = maxOf(0, next.length() - MAX_EXECUTED_IDS)
        for (index in start until next.length()) bounded.put(next.optString(index))
        prefs.edit().putString(EXECUTED_IDS_KEY, bounded.toString()).apply()
    }

    private fun isDeviceOwner(): Boolean {
        val manager = appContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
        return runCatching { manager?.isDeviceOwnerApp(appContext.packageName) == true }.getOrDefault(false)
    }

    private fun parseArray(raw: String?): JSONArray = runCatching { JSONArray(raw ?: "[]") }.getOrElse { JSONArray() }

    companion object {
        private const val PREFS_NAME = "cpipos_android_pos_full_mdm"
        private const val PENDING_RESULTS_KEY = "pending_results"
        private const val EXECUTED_IDS_KEY = "executed_ids"
        private const val POLICY_GENERATION_KEY = "policy_generation"
        private const val FULL_MDM_VERSION = "1.0.23"
        private const val MAX_PENDING_RESULTS = 20
        private const val MAX_EXECUTED_IDS = 80
        private val UUID_PATTERN = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
    }
}
