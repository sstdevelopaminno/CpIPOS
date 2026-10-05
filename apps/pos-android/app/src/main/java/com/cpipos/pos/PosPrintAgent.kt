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

/**
 * Native print worker for the managed Android POS runtime.
 *
 * Vercel remains the queue/control plane. This worker claims branch-scoped jobs
 * using the existing Print Agent lease protocol and performs the physical I/O
 * locally so LAN/USB/Bluetooth printers are reachable at the customer site.
 *
 * Production polling contract:
 * - heartbeat is independent from job polling and runs every 60 seconds;
 * - empty claims back off 1 -> 3 -> 8 -> 15 -> 30 seconds;
 * - any claimed work resets the idle backoff to one second;
 * - only one scheduled worker exists, so claim requests cannot overlap.
 */
class PosPrintAgent(
    context: Context,
    private val installId: String
) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences("cpipos_native_print_agent", Context.MODE_PRIVATE)
    private val transport = NativePrintTransport(appContext)
    private val started = AtomicBoolean(false)
    private val wakeBurstPending = AtomicBoolean(false)
    private var executor: ScheduledExecutorService? = null
    private var idleBackoffIndex = 0
    @Volatile private var bootstrapRetryAfterElapsedMs: Long = 0L

    @Volatile private var lastError: String? = null
    @Volatile private var lastJobId: String? = null
    @Volatile private var lastTransport: String? = null
    @Volatile private var lastSuccessAtMs: Long? = null
    @Volatile private var lastHeartbeatElapsedMs: Long = 0L

    fun start() {
        if (!started.compareAndSet(false, true)) return
        idleBackoffIndex = 0
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
        bootstrapRetryAfterElapsedMs = 0L
        lastHeartbeatElapsedMs = 0L
    }

    fun diagnosticsJson(): JSONObject = JSONObject()
        .put("enabled", started.get())
        .put("agent_provisioned", !prefs.getString(PREF_AGENT_KEY, null).isNullOrBlank())
        .put("last_job_id", lastJobId)
        .put("last_transport", lastTransport)
        .put("last_success_at_ms", lastSuccessAtMs)
        .put("last_error", lastError)
        .put("idle_backoff_seconds", IDLE_BACKOFF_SECONDS[idleBackoffIndex.coerceIn(0, IDLE_BACKOFF_SECONDS.lastIndex)])
        .put("bootstrap_retry_after_ms", (bootstrapRetryAfterElapsedMs - SystemClock.elapsedRealtime()).coerceAtLeast(0L))
        .put("heartbeat_interval_seconds", HEARTBEAT_INTERVAL_SECONDS)
        .put("supported_transports", JSONArray(listOf("lan", "usb", "bluetooth")))

    @JavascriptInterface
    fun notifyPrintQueued() {
        if (!started.get()) return
        idleBackoffIndex = 0
        scheduleWakeBurst()
    }

    private fun scheduleWakeBurst() {
        val service = executor ?: return
        if (!started.get() || service.isShutdown) return
        if (!wakeBurstPending.compareAndSet(false, true)) return

        runCatching {
            service.schedule({
                if (!started.get()) {
                    wakeBurstPending.set(false)
                    return@schedule
                }
                val firstClaim = runCatching { tick() }.getOrElse { error ->
                    lastError = error.message ?: error::class.java.simpleName
                    0
                }
                if (firstClaim > 0) {
                    idleBackoffIndex = 0
                    wakeBurstPending.set(false)
                    return@schedule
                }

                runCatching {
                    service.schedule({
                        try {
                            if (!started.get()) return@schedule
                            val retryClaim = runCatching { tick() }.getOrElse { error ->
                                lastError = error.message ?: error::class.java.simpleName
                                0
                            }
                            if (retryClaim > 0) idleBackoffIndex = 0
                        } finally {
                            wakeBurstPending.set(false)
                        }
                    }, WAKE_RETRY_DELAY_MS, TimeUnit.MILLISECONDS)
                }.onFailure {
                    wakeBurstPending.set(false)
                }
            }, 0L, TimeUnit.MILLISECONDS)
        }.onFailure { error ->
            wakeBurstPending.set(false)
            if (started.get()) lastError = error.message ?: "print_agent_wake_schedule_failed"
        }
    }

    private fun scheduleNext(delaySeconds: Long) {
        val service = executor ?: return
        if (!started.get() || service.isShutdown) return
        runCatching {
            service.schedule({
                if (started.get()) {
                    val claimedJobs = runCatching { tick() }.getOrElse { error ->
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

    private fun tick(): Int {
        if (!started.get()) return 0
        val key = getOrBootstrapKey() ?: return 0
        sendHeartbeatIfDue(key)

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

        val data = claim.body?.optJSONObject("data") ?: claim.body ?: return 0
        val jobs = data.optJSONArray("jobs") ?: return 0
        for (index in 0 until jobs.length()) {
            val row = jobs.optJSONObject(index) ?: continue
            processJob(key, row)
        }
        return jobs.length()
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
                        .put("claim_poll_policy", "adaptive_1_3_8_15_30s_wake")
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

        val now = SystemClock.elapsedRealtime()
        if (now < bootstrapRetryAfterElapsedMs) return null

        val response = postJson(
            url = "${BuildConfig.CPIPOS_API_BASE_URL}/api/android-pos/print-agent/bootstrap",
            body = JSONObject().put("runtime", "android_native_print_agent"),
            bootstrap = true
        )
        if (response.status !in 200..299) {
            lastError = readApiError(response.body) ?: "print_agent_bootstrap_http_${response.status}"
            bootstrapRetryAfterElapsedMs = now + if (response.status == 401 || response.status == 403) {
                BOOTSTRAP_AUTH_RETRY_DELAY_MS
            } else {
                BOOTSTRAP_TRANSIENT_RETRY_DELAY_MS
            }
            return null
        }

        val data = response.body?.optJSONObject("data") ?: response.body ?: return null
        val key = data.optString("agent_key", "").trim()
        if (key.isEmpty()) {
            lastError = "print_agent_bootstrap_key_missing"
            bootstrapRetryAfterElapsedMs = now + BOOTSTRAP_TRANSIENT_RETRY_DELAY_MS
            return null
        }
        val agent = data.optJSONObject("agent")
        prefs.edit()
            .putString(PREF_AGENT_KEY, key)
            .putString(PREF_AGENT_ID, agent?.optString("id", ""))
            .putString(PREF_DEVICE_CODE, agent?.optString("device_code", ""))
            .apply()
        bootstrapRetryAfterElapsedMs = 0L
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

        if (wasRecentlyPrinted(jobId)) {
            val ack = acknowledgePrintedJob(
                agentKey = agentKey,
                jobId = jobId,
                attemptId = attemptId,
                providerJobId = "android-dedupe:$jobId",
                bytesSent = 0,
                metadata = JSONObject()
                    .put("runtime", "android_native")
                    .put("transport", parsed.printer.metadata.optString("transport_mode", parsed.printer.connectionType))
                    .put("device_model", Build.MODEL)
                    .put("app_version", BuildConfig.VERSION_NAME)
                    .put("dedupe_replay", true)
                    .put("physical_print_skipped", true)
            )
            if (ack) {
                lastSuccessAtMs = System.currentTimeMillis()
                lastError = null
            }
            return
        }

        val printStartedAt = SystemClock.elapsedRealtime()
        try {
            val result = transport.print(parsed)
            val nativePrintMs = (SystemClock.elapsedRealtime() - printStartedAt).coerceAtLeast(0L)

            // Persist physical success BEFORE server ACK. If ACK is lost or times out, the
            // same job may be leased again; the retry must ACK without printing twice.
            rememberPrinted(jobId)

            val acked = acknowledgePrintedJob(
                agentKey = agentKey,
                jobId = jobId,
                attemptId = attemptId,
                providerJobId = result.providerJobId,
                bytesSent = result.bytesSent,
                metadata = JSONObject()
                    .put("runtime", "android_native")
                    .put("transport", result.transport)
                    .put("device_model", Build.MODEL)
                    .put("app_version", BuildConfig.VERSION_NAME)
                    .put("native_print_ms", nativePrintMs)
                    .put("bytes_sent", result.bytesSent)
                    .put("dedupe_replay", false)
            )
            if (acked) {
                lastTransport = result.transport
                lastSuccessAtMs = System.currentTimeMillis()
                lastError = null
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

    private fun acknowledgePrintedJob(
        agentKey: String,
        jobId: String,
        attemptId: String,
        providerJobId: String,
        bytesSent: Int,
        metadata: JSONObject
    ): Boolean {
        val ack = postJson(
            url = "${BuildConfig.CPIPOS_API_BASE_URL}/api/print-agent/v1/jobs/$jobId/ack",
            body = JSONObject()
                .put("agent_attempt_id", attemptId)
                .put("provider_job_id", providerJobId)
                .put("bytes_sent", bytesSent)
                .put("metadata", metadata),
            agentKey = agentKey
        )
        if (ack.status in 200..299) return true

        lastError = readApiError(ack.body) ?: "print_agent_ack_http_${ack.status}"
        if (ack.status == 401 || ack.status == 403) clearAgentKey()
        return false
    }

    private fun wasRecentlyPrinted(jobId: String): Boolean {
        val now = System.currentTimeMillis()
        val retained = readPrintedJobLedger(now)
        return retained.optLong(jobId, 0L).let { printedAt ->
            printedAt > 0L && now - printedAt <= PRINTED_JOB_TTL_MS
        }
    }

    private fun rememberPrinted(jobId: String) {
        val now = System.currentTimeMillis()
        val ledger = readPrintedJobLedger(now)
        ledger.put(jobId, now)

        val keys = ledger.keys().asSequence().toList()
        if (keys.size > PRINTED_JOB_LEDGER_MAX) {
            keys.sortedBy { ledger.optLong(it, Long.MAX_VALUE) }
                .take(keys.size - PRINTED_JOB_LEDGER_MAX)
                .forEach { ledger.remove(it) }
        }
        prefs.edit().putString(PREF_PRINTED_JOB_LEDGER, ledger.toString()).apply()
    }

    private fun readPrintedJobLedger(now: Long): JSONObject {
        val ledger = runCatching {
            JSONObject(prefs.getString(PREF_PRINTED_JOB_LEDGER, "{}").orEmpty())
        }.getOrElse { JSONObject() }
        val expired = ledger.keys().asSequence().toList().filter { key ->
            val printedAt = ledger.optLong(key, 0L)
            printedAt <= 0L || now - printedAt > PRINTED_JOB_TTL_MS
        }
        if (expired.isNotEmpty()) {
            expired.forEach { ledger.remove(it) }
            prefs.edit().putString(PREF_PRINTED_JOB_LEDGER, ledger.toString()).apply()
        }
        return ledger
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
                connectTimeout = 5_000
                readTimeout = 12_000
                doOutput = true
                useCaches = false
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Accept", "application/json")
                setRequestProperty("X-CpIPOS-App-Version", BuildConfig.VERSION_NAME)
                if (!agentKey.isNullOrBlank()) setRequestProperty("X-Print-Agent-Key", agentKey)
                if (bootstrap) {
                    setRequestProperty("X-CpIPOS-Android-POS", "true")
                    setRequestProperty("X-CpIPOS-Install-Id", installId)
                }
            }
            connection.outputStream.use { output ->
                output.write(body.toString().toByteArray(Charsets.UTF_8))
            }
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
        private const val PREF_PRINTED_JOB_LEDGER = "printed_job_ledger_v1"
        private const val HEARTBEAT_INTERVAL_SECONDS = 60L
        private const val HEARTBEAT_INTERVAL_MS = HEARTBEAT_INTERVAL_SECONDS * 1_000L
        private const val WAKE_RETRY_DELAY_MS = 350L
        private const val BOOTSTRAP_AUTH_RETRY_DELAY_MS = 5L * 60L * 1_000L
        private const val BOOTSTRAP_TRANSIENT_RETRY_DELAY_MS = 30L * 1_000L
        private const val PRINTED_JOB_TTL_MS = 24L * 60L * 60L * 1_000L
        private const val PRINTED_JOB_LEDGER_MAX = 120
        private val IDLE_BACKOFF_SECONDS = longArrayOf(1L, 3L, 8L, 15L, 30L)
    }
}