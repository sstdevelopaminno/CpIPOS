package com.cpipos.pos

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Development-safe in-app MDM bridge for the Android POS WebView runtime.
 *
 * This is intentionally not an Android Enterprise Device Owner implementation.
 * It does not expose remote shell, app install/uninstall, file browsing, wipe,
 * SMS, camera, microphone, or device-wide control. Commands are restricted to
 * safe app-level actions that help POS-machine/printer development.
 */
class PosMdmAgent(
    context: Context,
    private val webView: WebView
) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences("cpipos_android_pos_mdm", Context.MODE_PRIVATE)
    private val diagnostics = AndroidDiagnostics(appContext)
    private val mainHandler = Handler(Looper.getMainLooper())
    private val started = AtomicBoolean(false)
    private var executor: ScheduledExecutorService? = null

    @Volatile private var currentUrl: String? = null
    @Volatile private var currentTitle: String? = null
    @Volatile private var canGoBackState: Boolean = false
    @Volatile private var lastPageError: String? = null
    @Volatile private var lastCommandAction: String? = null
    @Volatile private var lastCommandSource: String? = null
    @Volatile private var lastCommandAtMs: Long? = null
    @Volatile private var lastPrinterDiagnostic: PrinterDiagnostic? = null

    val installId: String by lazy {
        val existing = prefs.getString("install_id", null)?.takeIf { it.isNotBlank() }
        existing ?: UUID.randomUUID().toString().also { value ->
            prefs.edit().putString("install_id", value).apply()
        }
    }

    fun start() {
        if (!started.compareAndSet(false, true)) return
        executor = Executors.newSingleThreadScheduledExecutor { runnable ->
            Thread(runnable, "cpipos-pos-mdm-lite").apply { isDaemon = true }
        }.also { service ->
            service.scheduleWithFixedDelay(
                { sendHeartbeat("periodic") },
                5,
                60,
                TimeUnit.SECONDS
            )
        }
        sendHeartbeat("started")
    }

    fun stop() {
        if (!started.compareAndSet(true, false)) return
        executor?.shutdownNow()
        executor = null
    }

    fun notifyPageStarted(url: String?) {
        currentUrl = url
        canGoBackState = webView.canGoBack()
        lastPageError = null
    }

    fun notifyPageFinished(url: String?) {
        currentUrl = url
        currentTitle = webView.title
        canGoBackState = webView.canGoBack()
        sendHeartbeat("page_finished")
    }

    fun notifyPageError(url: String?, description: String?) {
        currentUrl = url
        canGoBackState = webView.canGoBack()
        lastPageError = description?.take(240)
        sendHeartbeat("page_error")
    }

    @JavascriptInterface
    fun diagnosticsJson(): String = buildSnapshot("javascript").toString()

    @JavascriptInterface
    fun executeCommand(action: String): String = executeSafeCommand(action, "javascript").toString()

    fun executeSafeCommand(action: String, source: String = "remote"): JSONObject {
        val normalized = action.trim().lowercase()
        if (normalized !in SAFE_ACTIONS) {
            return JSONObject()
                .put("ok", false)
                .put("error", "command_not_allowed")
                .put("action", normalized)
        }

        lastCommandAction = normalized
        lastCommandSource = source
        lastCommandAtMs = System.currentTimeMillis()

        when (normalized) {
            "ping" -> sendHeartbeat("command_ping")
            "collect_diagnostics" -> sendHeartbeat("command_collect_diagnostics")
            "reload_webview" -> mainHandler.post {
                if (webView.url.isNullOrBlank()) webView.loadUrl(BuildConfig.CPIPOS_POS_WEB_URL) else webView.reload()
                currentUrl = webView.url
                currentTitle = webView.title
                canGoBackState = webView.canGoBack()
            }
            "navigate_home" -> mainHandler.post {
                webView.loadUrl(BuildConfig.CPIPOS_POS_WEB_URL)
                currentUrl = BuildConfig.CPIPOS_POS_WEB_URL
                currentTitle = webView.title
                canGoBackState = webView.canGoBack()
            }
            "clear_webview_cache" -> mainHandler.post {
                webView.clearCache(true)
                canGoBackState = webView.canGoBack()
                sendHeartbeat("command_clear_webview_cache")
            }
            "clear_cookies" -> mainHandler.post {
                CookieManager.getInstance().removeAllCookies(null)
                CookieManager.getInstance().flush()
                sendHeartbeat("command_clear_cookies")
            }
            "clear_webview_data" -> mainHandler.post {
                webView.clearCache(true)
                webView.clearHistory()
                CookieManager.getInstance().removeAllCookies(null)
                CookieManager.getInstance().flush()
                webView.loadUrl(BuildConfig.CPIPOS_POS_WEB_URL)
                currentUrl = BuildConfig.CPIPOS_POS_WEB_URL
                currentTitle = webView.title
                canGoBackState = false
                sendHeartbeat("command_clear_webview_data")
            }
            "test_printer_connection" -> executor?.execute {
                lastPrinterDiagnostic = diagnostics.testPrinterConnection(timeoutMs = 1800)
                sendHeartbeat("command_test_printer_connection")
            }
        }

        return JSONObject()
            .put("ok", true)
            .put("action", normalized)
            .put("source", source)
    }

    private fun sendHeartbeat(reason: String) {
        val service = executor
        if (service == null) {
            Thread { postHeartbeat(reason) }.start()
            return
        }
        service.execute { postHeartbeat(reason) }
    }

    private fun postHeartbeat(reason: String) {
        runCatching {
            val payload = buildSnapshot(reason)
            val connection = (URL(BuildConfig.CPIPOS_MDM_HEARTBEAT_URL).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 4500
                readTimeout = 4500
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Accept", "application/json")
                setRequestProperty("X-CpIPOS-Android-POS", "true")
                setRequestProperty("X-CpIPOS-Install-Id", installId)
                setRequestProperty("X-CpIPOS-App-Version", BuildConfig.VERSION_NAME)
            }

            connection.outputStream.use { output ->
                output.write(payload.toString().toByteArray(Charsets.UTF_8))
            }

            val status = connection.responseCode
            val responseText = if (status in 200..299) {
                connection.inputStream.bufferedReader().use { it.readText() }
            } else {
                connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
            }
            connection.disconnect()

            if (status in 200..299 && responseText.isNotBlank()) {
                applyCommandsFromResponse(responseText)
            }
        }
    }

    private fun applyCommandsFromResponse(responseText: String) {
        runCatching {
            val response = JSONObject(responseText)
            val commands = when {
                response.has("commands") -> response.optJSONArray("commands")
                response.has("data") -> response.optJSONObject("data")?.optJSONArray("commands")
                else -> null
            } ?: return

            for (index in 0 until commands.length()) {
                val command = commands.optJSONObject(index) ?: continue
                val action = command.optString("action", "")
                if (action.isNotBlank()) executeSafeCommand(action, "heartbeat_response")
            }
        }
    }

    private fun buildSnapshot(reason: String): JSONObject {
        val printer = lastPrinterDiagnostic
        return JSONObject()
            .put("reason", reason)
            .put("install_id", installId)
            .put("timestamp_ms", System.currentTimeMillis())
            .put("safe_command_allowlist", JSONArray(SAFE_ACTIONS.toList()))
            .put(
                "app",
                JSONObject()
                    .put("package", BuildConfig.APPLICATION_ID)
                    .put("version_name", BuildConfig.VERSION_NAME)
                    .put("version_code", BuildConfig.VERSION_CODE)
                    .put("runtime", "android-pos-webview-mdm-lite")
                    .put("web_entrypoint", BuildConfig.CPIPOS_POS_WEB_URL)
            )
            .put(
                "device",
                JSONObject()
                    .put("manufacturer", Build.MANUFACTURER)
                    .put("brand", Build.BRAND)
                    .put("model", Build.MODEL)
                    .put("device", Build.DEVICE)
                    .put("product", Build.PRODUCT)
                    .put("sdk_int", Build.VERSION.SDK_INT)
                    .put("android_release", Build.VERSION.RELEASE)
                    .put("uptime_ms", SystemClock.uptimeMillis())
            )
            .put(
                "network",
                JSONObject()
                    .put("online", diagnostics.networkOnline())
                    .put("type", diagnostics.networkType())
            )
            .put(
                "health",
                JSONObject()
                    .put("battery_percent", diagnostics.batteryPercent())
                    .put("app_memory_mb", diagnostics.appMemoryMb())
                    .put("available_storage_mb", diagnostics.availableStorageMb())
                    .put("device_owner", diagnostics.isDeviceOwnerKnown())
            )
            .put(
                "webview",
                JSONObject()
                    .put("url", currentUrl)
                    .put("title", currentTitle)
                    .put("can_go_back", canGoBackState)
                    .put("last_page_error", lastPageError)
            )
            .put(
                "printer",
                JSONObject()
                    .put("configured_host", diagnostics.printerHost())
                    .put("configured_port", diagnostics.printerPort())
                    .put("last_reachable", printer?.reachable)
                    .put("last_error", printer?.lastError)
            )
            .put(
                "last_command",
                JSONObject()
                    .put("action", lastCommandAction)
                    .put("source", lastCommandSource)
                    .put("at_ms", lastCommandAtMs)
            )
    }

    companion object {
        private val SAFE_ACTIONS = setOf(
            "ping",
            "collect_diagnostics",
            "reload_webview",
            "navigate_home",
            "clear_webview_cache",
            "clear_cookies",
            "clear_webview_data",
            "test_printer_connection"
        )
    }
}
