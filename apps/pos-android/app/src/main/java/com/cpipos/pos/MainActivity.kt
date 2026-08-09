package com.cpipos.pos

import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.cpipos.pos.databinding.ActivityMainBinding
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

/**
 * CpIPOS Android Tablet production shell.
 *
 * The production Web App is the authoritative customer-facing POS UI. This native layer owns
 * only Android platform capabilities: fullscreen/window integration, connectivity recovery,
 * persistent WebView session, versioned native bridge, MDM heartbeat/commands and future
 * hardware integration. Do not port POS business screens back into this activity.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var connectivityManager: ConnectivityManager
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var pageLoadTimeoutRunnable: Runnable? = null
    private var mdmHeartbeatRunnable: Runnable? = null

    companion object {
        private const val DEFAULT_START_URL = "https://cp-ipos-web.vercel.app/login/store"
        private const val ALLOWED_HOST = "cp-ipos-web.vercel.app"
        private const val NATIVE_BRIDGE_VERSION = "1.1.0"
        private const val PAGE_LOAD_TIMEOUT_MS = 20_000L
        private const val MDM_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000L
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        applyFullscreen()
        setupWebView()
        setupNetworkMonitor()
        setupBackNavigation()

        binding.reloadButton.setOnClickListener {
            binding.offlineBanner.visibility = View.GONE
            binding.webView.reload()
            schedulePageLoadTimeout()
        }

        binding.webView.loadUrl(DEFAULT_START_URL)
        schedulePageLoadTimeout()
    }

    private fun applyFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, binding.root).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyFullscreen()
    }

    private fun setupWebView() {
        val webView = binding.webView
        val settings = webView.settings

        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.userAgentString = "${settings.userAgentString} CpIPOSAndroidRuntime/${BuildConfig.VERSION_NAME}"

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, false)
        }

        webView.addJavascriptInterface(CpIPOSBridge(), "CpIPOSBridge")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (isTrustedCpiposUri(uri)) return false

                runCatching {
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                }
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                schedulePageLoadTimeout()
            }

            override fun onPageFinished(view: WebView, url: String?) {
                super.onPageFinished(view, url)
                cancelPageLoadTimeout()
                CookieManager.getInstance().flush()
                if (isNetworkAvailable()) binding.offlineBanner.visibility = View.GONE
                if (url?.let { runCatching { Uri.parse(it) }.getOrNull() }?.let(::isTrustedCpiposUri) == true) {
                    startMdmHeartbeat()
                }
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                super.onReceivedError(view, request, error)
                if (request.isForMainFrame) {
                    cancelPageLoadTimeout()
                    binding.offlineBanner.visibility = View.VISIBLE
                }
            }
        }
    }

    private fun isTrustedCpiposUri(uri: Uri): Boolean {
        return uri.scheme.equals("https", ignoreCase = true) &&
            uri.host.equals(ALLOWED_HOST, ignoreCase = true)
    }

    private fun schedulePageLoadTimeout() {
        cancelPageLoadTimeout()
        val runnable = Runnable { binding.offlineBanner.visibility = View.VISIBLE }
        pageLoadTimeoutRunnable = runnable
        mainHandler.postDelayed(runnable, PAGE_LOAD_TIMEOUT_MS)
    }

    private fun cancelPageLoadTimeout() {
        pageLoadTimeoutRunnable?.let(mainHandler::removeCallbacks)
        pageLoadTimeoutRunnable = null
    }

    private fun setupNetworkMonitor() {
        connectivityManager = getSystemService(ConnectivityManager::class.java)
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                runOnUiThread {
                    binding.offlineBanner.visibility = View.GONE
                    if (binding.webView.url.isNullOrBlank()) binding.webView.loadUrl(DEFAULT_START_URL)
                }
            }

            override fun onLost(network: Network) {
                runOnUiThread { binding.offlineBanner.visibility = View.VISIBLE }
            }
        }

        networkCallback = callback
        connectivityManager.registerNetworkCallback(request, callback)
        binding.offlineBanner.visibility = if (isNetworkAvailable()) View.GONE else View.VISIBLE
    }

    private fun isNetworkAvailable(): Boolean {
        val network = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (binding.webView.canGoBack()) {
                    binding.webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                    isEnabled = true
                }
            }
        })
    }

    /**
     * MDM heartbeat deliberately runs from the trusted WebView origin. This makes the request use
     * the exact same authenticated HttpOnly session cookies as the authoritative Web App, instead
     * of maintaining a second native login/session stack.
     */
    private fun startMdmHeartbeat() {
        if (mdmHeartbeatRunnable != null) return

        sendMdmHeartbeat("startup")
        val runnable = object : Runnable {
            override fun run() {
                sendMdmHeartbeat("interval")
                mainHandler.postDelayed(this, MDM_HEARTBEAT_INTERVAL_MS)
            }
        }
        mdmHeartbeatRunnable = runnable
        mainHandler.postDelayed(runnable, MDM_HEARTBEAT_INTERVAL_MS)
    }

    private fun stopMdmHeartbeat() {
        mdmHeartbeatRunnable?.let(mainHandler::removeCallbacks)
        mdmHeartbeatRunnable = null
    }

    private fun sendMdmHeartbeat(reason: String) {
        val currentUri = binding.webView.url
            ?.let { runCatching { Uri.parse(it) }.getOrNull() }
            ?: return
        if (!isTrustedCpiposUri(currentUri)) return

        val capturedAt = Instant.now().toString()
        val payload = JSONObject()
            .put(
                "identity",
                JSONObject()
                    .put("device_code", "POS-DEVICE")
                    .put("machine_id", mdmMachineId())
                    .put("hostname", Build.MODEL)
                    .put("runtime_version", "android-webview-pos")
                    .put("app_version", BuildConfig.VERSION_NAME)
            )
            .put(
                "connectivity",
                JSONObject()
                    .put("internet_online", isNetworkAvailable())
                    .put("server_reachable", true)
                    .put("network_type", "android_webview_pos")
                    .put("last_seen_at", capturedAt)
            )
            .put(
                "system",
                JSONObject()
                    .put("os_name", "Android")
                    .put("os_version", Build.VERSION.RELEASE)
                    .put("device_model", Build.MODEL)
                    .put("device_manufacturer", Build.MANUFACTURER)
                    .put("sdk_int", Build.VERSION.SDK_INT)
            )
            .put(
                "runtime",
                JSONObject()
                    .put("cpi_windows_runtime_running", false)
                    .put("local_bridge_online", false)
                    .put("bridge_version", NATIVE_BRIDGE_VERSION)
            )
            .put("peripherals", JSONObject())
            .put(
                "metadata",
                JSONObject()
                    .put("source", "android_webview_pos_mdm")
                    .put("reason", reason)
            )
            .put("captured_at", capturedAt)

        val payloadLiteral = JSONObject.quote(payload.toString())
        val script = """
            (() => {
              try {
                const payload = JSON.parse($payloadLiteral);
                fetch('/api/pos/device-heartbeat', {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                  body: JSON.stringify(payload)
                })
                  .then((response) => response.ok ? response.json() : null)
                  .then((root) => {
                    const actions = root && root.data && Array.isArray(root.data.pending_actions)
                      ? root.data.pending_actions
                      : [];
                    if (window.CpIPOSBridge && typeof window.CpIPOSBridge.handleMdmActions === 'function') {
                      window.CpIPOSBridge.handleMdmActions(JSON.stringify(actions));
                    }
                  })
                  .catch(() => {});
              } catch (_) {}
            })();
        """.trimIndent()

        binding.webView.evaluateJavascript(script, null)
    }

    private fun mdmMachineId(): String {
        val prefs = getSharedPreferences("cpipos_tablet_pos_mdm", MODE_PRIVATE)
        val existing = prefs.getString("machine_id", null)
        if (!existing.isNullOrBlank()) return existing

        val generated = "and-${UUID.randomUUID()}"
        prefs.edit().putString("machine_id", generated).apply()
        return generated
    }

    private inner class CpIPOSBridge {
        @JavascriptInterface
        fun getAppVersion(): String = bridgeResponse(mapOf("version" to BuildConfig.VERSION_NAME))

        @JavascriptInterface
        fun getBridgeVersion(): String = bridgeResponse(mapOf("version" to NATIVE_BRIDGE_VERSION))

        @JavascriptInterface
        fun getDeviceInfo(): String = bridgeResponse(
            mapOf(
                "os" to "android",
                "os_version" to Build.VERSION.RELEASE,
                "sdk_int" to Build.VERSION.SDK_INT,
                "model" to Build.MODEL,
                "manufacturer" to Build.MANUFACTURER,
                "machine_id" to mdmMachineId()
            )
        )

        @JavascriptInterface
        fun getNetworkStatus(): String = bridgeResponse(mapOf("online" to isNetworkAvailable()))

        @JavascriptInterface
        fun handleMdmActions(actionsJson: String) {
            val actions = runCatching { JSONArray(actionsJson) }.getOrNull() ?: return
            mainHandler.post {
                var reloadRequested = false
                for (index in 0 until actions.length()) {
                    val command = actions.optJSONObject(index)?.optString("command_type").orEmpty()
                    when (command) {
                        "reload_ui", "refresh_config", "restart_app" -> reloadRequested = true
                        "request_diagnostics_bundle", "request_diagnostics", "test_network" -> sendMdmHeartbeat(command)
                        "test_printer", "disable_device", "enable_device", "clear_print_queue",
                        "restart_local_bridge", "restart_print_service", "check_update" -> Unit
                    }
                }
                if (reloadRequested) binding.webView.reload()
            }
        }

        private fun bridgeResponse(data: Map<String, Any?>): String {
            val payload = JSONObject()
            payload.put("ok", true)
            payload.put("data", JSONObject(data))
            payload.put("error", JSONObject.NULL)
            payload.put("bridge_version", NATIVE_BRIDGE_VERSION)
            payload.put("native_app_version", BuildConfig.VERSION_NAME)
            return payload.toString()
        }
    }

    override fun onDestroy() {
        cancelPageLoadTimeout()
        stopMdmHeartbeat()
        networkCallback?.let { callback -> runCatching { connectivityManager.unregisterNetworkCallback(callback) } }
        binding.webView.removeJavascriptInterface("CpIPOSBridge")
        binding.webView.stopLoading()
        binding.webView.destroy()
        super.onDestroy()
    }
}
