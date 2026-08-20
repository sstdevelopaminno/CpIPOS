package com.cpipos.pos

import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** Native print worker for the managed Android POS runtime. */
class PosPrintAgent(
    context: Context,
    private val installId: String
) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences("cpipos_native_print_agent", Context.MODE_PRIVATE)
    private val transport = NativePrintTransport(appContext)
    private val started = AtomicBoolean(false)
    private val lastWakeRequestElapsedMs = AtomicLong(0L)
    private var executor: ScheduledExecutorService? = null
    private var idleBackoffIndex = 0

    @Volatile private var lastError: String? = null
    @Volatile private var lastJobId: String? = null
    @Volatile private var lastTransport: String? = null
    @Volatile private var lastSuccessAtMs: Long? = null
    @Volatile private var lastHeartbeatElapsedMs: Long = 0L
    @Volatile private var lastRenderMode: String? = null
    @Volatile private var lastPayloadBuildMs: Long? = null
    @Volatile private var lastTransportWriteMs: Long? = null

    fun start() {
        if (!started.compareAndSet(false, true)) return
        idleBackoffIndex = 0
        lastWakeRequestElapsedMs.set(0L)
        executor = Executors.newSingleThreadScheduledExecutor { runnable ->
            Thread(runnable, "cpipos-native-print-agent").apply { isDaemon = true }
        }
        scheduleNext(0L)
    }

    fun stop() {
        if (!started.compareAndSet(true, false)) return
        executor?.shutdownNow()
        executor = null
        idleBackoffIndex = 0
        lastHeartbeatElapsedMs = 0L
        lastWakeRequestElapsedMs.set(0L)
    }

    fun diagnosticsJson(): JSONObject = JSONObject()
        .put("enabled", started.get())
        .put("agent_provisioned", !prefs.getString(PREF_AGENT_KEY, null).isNullOrBlank())
        .put("last_job_id", lastJobId)
        .put("last_transport", lastTransport)
        .put("last_success_at_ms", lastSuccessAtMs)
        .put("last_error", lastError)
        .put("last_render_mode", lastRenderMode)
        .put("last_payload_build_ms", lastPayloadBuildMs)
        .put("last_transport_write_ms", lastTransportWriteMs)
        .put("idle_backoff_seconds", IDLE_BACKOFF_SECONDS[idleBackoffIndex.coerceIn(0, IDLE_BACKOFF_SECONDS.lastIndex)])
        .put("heartbeat_interval_seconds", HEARTBEAT_INTERVAL_SECONDS)
        .put("claim_policy", "event_wake_plus_adaptive_1_2_3s")
        .put("supported_transports", JSONArray(listOf("lan", "usb", "bluetooth")))

    @JavascriptInterface
    fun notifyPrintQueued() {
        if (!started.get()) return
        val now = SystemClock.elapsedRealtime()
        val previous = lastWakeRequestElapsedMs.get()
        if (previous > 0L && now - previous < WAKE_COALESCE_MS) return
        lastWakeRequestElapsedMs.set(now)
        idleBackoffIndex = 0
        scheduleWakeClaim(0L)
        scheduleWakeClaim(WAKE_RETRY_DELAY_MS)
    }

    private fun scheduleWakeClaim(delayMs: Long) {
        val service = executor ?: return
        if (!started.get() || service.isShutdown) return
        runCatching {
            service.schedule({
                if (!started.get()) return@schedule
                val claimedJobs = runCatching { tick(prioritizePrint = true) }.getOrElse { error ->
                    lastError = error.message ?: error::class.java.simpleName
                    0
                }
                if (claimedJobs > 0) idleBackoffIndex = 0
            }, delayMs.coerceAtLeast(0L), TimeUnit.MILLISECONDS)
        }.onFailure { error ->
            if (started.get()) lastError = error.message ?: "print_agent_wake_schedule_failed"
        }
    }

    private fun scheduleNext(delaySeconds: Long) {
        val service = executor ?: return
        if (!started.get() || service.isShutdown) return
        runCatching {
            service.schedule({
                if (started.get()) {
                    val claimedJobs = runCatching { tick(prioritizePrint = false) }.getOrElse { error ->
                        lastError = error.message ?: error::class.java.simpleName
                        0
                    }
                    val nextDelay = if (claimedJobs > 0) {
                        idleBackoffIndex = 0
                        IDLE_BACKOFF_SECONDS.first()
                    } else {
                        val delay = IDLE_BACKOFF_SECONDS[idleBackoffIndex.coerceIn(0, IDLE_BACKOFF_SECONDS.lastIndex)]
                        if (idleBackoffIndex < IDLE_BACKOFF_SECONDS.lastIndex) idleBackoffIndex += 1
                        delay
                    }
                    scheduleNext(nextDelay)
                }
            }, delaySeconds.coerceAtLeast(0L), TimeUnit.SECONDS)
        }.onFailure { error ->
            if (started.get()) lastError = error.message ?: "print_agent_schedule_failed"
        }
    }

    private fun tick(prioritizePrint: Boolean): Int {
        if (!started.get()) return 0
        val key = getOrBootstrapKey() ?: return 0
        if (!prioritizePrint) sendHeartbeatIfDue(key)

        val claim = postJson(
            url = "${BuildConfig.CPIPOS_API_BASE_URL}/api/print-agent/v1/jobs/claim",
            body = JSONObject()
                .put("limit", 3)
                .put("lease_seconds", 60)
                .put("app_version", BuildConfig.VERSION_NAME),
            agentKey = key
        )

        if (claim.status == 401 || claim.status == 403) {
            clearAgentKey()
            lastError = "print_agent_auth_expired"
            return 0
        }
        if (claim.status !in 200..299) {
            lastError = readApiError(claim.body) ?: "print_agent_claim_http_${claim.status}"
            return 0
        }

        val data = claim.body?.optJSONObject("data") ?: claim.body
        val jobs = data?.optJSONArray("jobs")
        val count = jobs?.length() ?: 0
        if (jobs != null) {
            for (index in 0 until jobs.length()) {
                val row = jobs.optJSONObject(index) ?: continue
                processJob(key, row)
            }
        }
        if (prioritizePrint) sendHeartbeatIfDue(key)
        return count
    }

    private fun sendHeartbeatIfDue(agentKey: String) {
        val now = SystemClock.elapsedRealtime()
        if (lastHeartbeatElapsedMs != 0L && now - lastHeartbeatElapsedMs < HEARTBEAT_INTERVAL_MS) return

        val response = postJson(
            url = "${BuildConfig.CPIPOS_API_BASE_URL}/api/print-agent/v1/heartbeat",
            body = JSONObject()
                .put("app_version", BuildConfig.VERSION_NAME)
                .put(
                    "metadata",
                    JSONObject()
                        .put("runtime", "android_native_print_agent")
                        .put("device_model", Build.MODEL)
                        .put("claim_poll_policy", "event_wake_plus_adaptive_1_2_3s")
                        .put("low_latency_print", true)
                ),
            agentKey = agentKey
        )

        if (response.status == 401 || response.status == 403) {
            clearAgentKey()
            lastError = "print_agent_auth_expired"
            return
        }
        if (response.status in 200..299) {
            lastHeartbeatElapsedMs = now
        } else {
            lastError = readApiError(response.body) ?: "print_agent_heartbeat_http_${response.status}"
        }
    }

    private fun getOrBootstrapKey(): String? {
        prefs.getString(PREF_AGENT_KEY, null)?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }

        val response = postJson(
            url = "${BuildConfig.CPIPOS_API_BASE_URL}/api/android-pos/print-agent/bootstrap",
            body = JSONObject().put("runtime", "android_native_print_agent"),
            bootstrap = true
        )
        if (response.status !in 200..299) {
            lastError = readApiError(response.body) ?: "print_agent_bootstrap_http_${response.status}"
            return null
        }

        val data = response.body?.optJSONObject("data") ?: response.body ?: return null
        val key = data.optString("agent_key", "").trim()
        if (key.isEmpty()) {
            lastError = "print_agent_bootstrap_key_missing"
            return null
        }
        val agent = data.optJSONObject("agent")
        prefs.edit()
            .putString(PREF_AGENT_KEY, key)
            .putString(PREF_AGENT_ID, agent?.optString("id", ""))
            .putString(PREF_DEVICE_CODE, agent?.optString("device_code", ""))
            .apply()
        lastHeartbeatElapsedMs = 0L
        lastError = null
        return key
    }

    private fun processJob(agentKey: String, row: JSONObject) {
        val jobId = row.optString("id", "").trim()
        val attemptId = row.optString("agent_attempt_id", "").trim()
        if (jobId.isEmpty() || attemptId.isEmpty()) return

        lastJobId = jobId
        val parsed = runCatching { parseJob(row) }.getOrElse { error ->
            reportFailure(
                agentKey,
                jobId,
                attemptId,
                "invalid_print_job",
                error.message ?: "Invalid print job payload",
                false,
                JSONObject().put("runtime", "android_native")
            )
            return
        }

        val printStartedAt = SystemClock.elapsedRealtime()
        try {
            val result = transport.print(parsed)
            val nativePrintMs = (SystemClock.elapsedRealtime() - printStartedAt).coerceAtLeast(0L)
            val ack = postJson(
                url = "${BuildConfig.CPIPOS_API_BASE_URL}/api/print-agent/v1/jobs/$jobId/ack",
                body = JSONObject()
                    .put("agent_attempt_id", attemptId)
                    .put("provider_job_id", result.providerJobId)
                    .put("bytes_sent", result.bytesSent)
                    .put(
                        "metadata",
                        JSONObject()
                            .put("runtime", "android_native")
                            .put("transport", result.transport)
                            .put("device_model", Build.MODEL)
                            .put("app_version", BuildConfig.VERSION_NAME)
                            .put("native_print_ms", nativePrintMs)
                            .put("render_mode", result.renderMode)
                            .put("payload_build_ms", result.payloadBuildMs)
                            .put("transport_write_ms", result.transportWriteMs)
                            .put("bytes_sent", result.bytesSent)
                    ),
                agentKey = agentKey
            )
            if (ack.status in 200..299) {
                lastTransport = result.transport
                lastSuccessAtMs = System.currentTimeMillis()
                lastRenderMode = result.renderMode
                lastPayloadBuildMs = result.payloadBuildMs
                lastTransportWriteMs = result.transportWriteMs
                lastError = null
            } else {
                lastError = readApiError(ack.body) ?: "print_agent_ack_http_${ack.status}"
                if (ack.status == 401 || ack.status == 403) clearAgentKey()
            }
        } catch (error: NativePrintException) {
            lastError = "${error.code}:${error.message.orEmpty()}"
            reportFailure(
                agentKey,
                jobId,
                attemptId,
                error.code,
                error.message ?: error.code,
                error.retryable,
                JSONObject()
                    .put("runtime", "android_native")
                    .put("transport", parsed.printer.metadata.optString("transport_mode", parsed.printer.connectionType))
                    .put("device_model", Build.MODEL)
                    .put("app_version", BuildConfig.VERSION_NAME)
                    .put("native_print_ms", (SystemClock.elapsedRealtime() - printStartedAt).coerceAtLeast(0L))
            )
        } catch (error: Throwable) {
            lastError = error.message ?: "native_print_failed"
            reportFailure(
                agentKey,
                jobId,
                attemptId,
                "native_print_failed",
                error.message ?: "Native print failed",
                true,
                JSONObject()
                    .put("runtime", "android_native")
                    .put("device_model", Build.MODEL)
                    .put("app_version", BuildConfig.VERSION_NAME)
                    .put("native_print_ms", (SystemClock.elapsedRealtime() - printStartedAt).coerceAtLeast(0L))
            )
        }
    }

    private fun reportFailure(
        agentKey: String,
        jobId: String,
        attemptId: String,
        errorCode: String,
        errorMessage: String,
        retryable: Boolean,
        metadata: JSONObject
    ) {
        val response = postJson(
            url = "${BuildConfig.CPIPOS_API_BASE_URL}/api/print-agent/v1/jobs/$jobId/fail",
            body = JSONObject()
                .put("agent_attempt_id", attemptId)
                .put("error_code", errorCode.take(120))
                .put("error_message", errorMessage.take(500))
                .put("retryable", retryable)
                .put("metadata", metadata),
            agentKey = agentKey
        )
        if (response.status == 401 || response.status == 403) clearAgentKey()
    }

    private fun parseJob(row: JSONObject): NativePrintJob {
        val printer = when (val value = row.opt("printer_profiles")) {
            is JSONObject -> value
            is JSONArray -> value.optJSONObject(0)
            else -> null
        } ?: throw IllegalArgumentException("printer_profile_missing")

        val profileMetadata = printer.optJSONObject("metadata") ?: JSONObject()
        return NativePrintJob(
            id = row.getString("id"),
            attemptId = row.getString("agent_attempt_id"),
            payloadText = row.optString("payload_text", ""),
            payloadJson = row.optJSONObject("payload_json") ?: JSONObject(),
            metadata = row.optJSONObject("metadata") ?: JSONObject(),
            printer = NativePrinterProfile(
                id = printer.optString("id", ""),
                name = printer.optString("printer_name", "Printer"),
                connectionType = printer.optString("connection_type", ""),
                ipAddress = printer.optString("ip_address", "").trim().takeIf { it.isNotEmpty() },
                port = if (printer.has("port") && !printer.isNull("port")) printer.optInt("port", 9100) else null,
                metadata = profileMetadata
            )
        )
    }

    private data class HttpJsonResponse(val status: Int, val body: JSONObject?)

    private fun postJson(
        url: String,
        body: JSONObject,
        agentKey: String? = null,
        bootstrap: Boolean = false
    ): HttpJsonResponse {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 4_000
                readTimeout = 10_000
                doOutput = true
                useCaches = false
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Connection", "keep-alive")
                setRequestProperty("X-CpIPOS-App-Version", BuildConfig.VERSION_NAME)
                if (!agentKey.isNullOrBlank()) setRequestProperty("X-Print-Agent-Key", agentKey)
                if (bootstrap) {
                    setRequestProperty("X-CpIPOS-Android-POS", "true")
                    setRequestProperty("X-CpIPOS-Install-Id", installId)
                }
            }
            connection.outputStream.use { output -> output.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val text = if (status in 200..299) {
                connection.inputStream?.bufferedReader()?.use { it.readText() }.orEmpty()
            } else {
                connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
            }
            HttpJsonResponse(status, text.takeIf { it.isNotBlank() }?.let { JSONObject(it) })
        } catch (error: Throwable) {
            lastError = error.message ?: "print_agent_network_error"
            HttpJsonResponse(599, null)
        } finally {
            connection?.disconnect()
        }
    }

    private fun readApiError(body: JSONObject?): String? {
        val error = body?.optJSONObject("error") ?: return null
        val code = error.optString("code", "").trim()
        val message = error.optString("message", "").trim()
        return listOf(code, message).filter { it.isNotEmpty() }.joinToString(": ").takeIf { it.isNotEmpty() }
    }

    private fun clearAgentKey() {
        prefs.edit().remove(PREF_AGENT_KEY).remove(PREF_AGENT_ID).apply()
        lastHeartbeatElapsedMs = 0L
    }

    companion object {
        private const val PREF_AGENT_KEY = "agent_key"
        private const val PREF_AGENT_ID = "agent_id"
        private const val PREF_DEVICE_CODE = "device_code"
        private const val HEARTBEAT_INTERVAL_SECONDS = 45L
        private const val HEARTBEAT_INTERVAL_MS = HEARTBEAT_INTERVAL_SECONDS * 1_000L
        private const val WAKE_COALESCE_MS = 75L
        private const val WAKE_RETRY_DELAY_MS = 180L
        private val IDLE_BACKOFF_SECONDS = longArrayOf(1L, 2L, 3L)
    }
}
