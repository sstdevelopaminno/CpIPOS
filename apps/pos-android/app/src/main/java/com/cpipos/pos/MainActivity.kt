package com.cpipos.pos

import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
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
import org.json.JSONObject

/**
 * CpIPOS Android Phase 1 runtime shell.
 *
 * This activity is intentionally a thin WebView wrapper around the existing CpIPOS web POS UI.
 * The web app remains the source of truth for POS screens, login, sales, payment, and receipt
 * behavior — see docs/ANDROID-FULLSCREEN-APK-RUNTIME-PLAN.md. Do not port POS UI/business logic
 * into this native layer.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var connectivityManager: ConnectivityManager
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var pageLoadTimeoutRunnable: Runnable? = null

    companion object {
        private const val DEFAULT_START_URL = "https://cp-ipos-web.vercel.app/login/store"
        private const val NATIVE_BRIDGE_VERSION = "1.0.0"

        // If loadUrl/reload doesn't reach onPageFinished or onReceivedError within this
        // window (e.g. a stalled DNS/TLS handshake on flaky store Wi-Fi), the fullscreen
        // WebView gives the user no way out on its own — surface the offline banner so
        // there's a visible reload affordance instead of an indefinitely frozen screen.
        private const val PAGE_LOAD_TIMEOUT_MS = 20000L
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        installSplashScreen()

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

    private fun schedulePageLoadTimeout() {
        cancelPageLoadTimeout()
        val runnable = Runnable { binding.offlineBanner.visibility = View.VISIBLE }
        pageLoadTimeoutRunnable = runnable
        mainHandler.postDelayed(runnable, PAGE_LOAD_TIMEOUT_MS)
    }

    private fun cancelPageLoadTimeout() {
        pageLoadTimeoutRunnable?.let { mainHandler.removeCallbacks(it) }
        pageLoadTimeoutRunnable = null
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyFullscreen()
    }

    private fun applyFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, binding.root)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
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
        settings.userAgentString = "${settings.userAgentString} CpIPOSAndroidRuntime/${BuildConfig.VERSION_NAME}"

        webView.addJavascriptInterface(CpIPOSBridge(), "CpIPOSBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Keep navigation inside this WebView; CpIPOS routes are all same-origin.
                return false
            }

            override fun onPageFinished(view: WebView, url: String?) {
                super.onPageFinished(view, url)
                cancelPageLoadTimeout()
                if (isNetworkAvailable()) {
                    binding.offlineBanner.visibility = View.GONE
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

    private fun setupNetworkMonitor() {
        connectivityManager = getSystemService(ConnectivityManager::class.java)
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                runOnUiThread { binding.offlineBanner.visibility = View.GONE }
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
        val callback = object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (binding.webView.canGoBack()) {
                    binding.webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                    isEnabled = true
                }
            }
        }
        onBackPressedDispatcher.addCallback(this, callback)
    }

    override fun onDestroy() {
        cancelPageLoadTimeout()
        networkCallback?.let { connectivityManager.unregisterNetworkCallback(it) }
        super.onDestroy()
    }

    /**
     * Phase 1 native bridge: read-only device/version/network info only, per
     * docs/ANDROID-NATIVE-BRIDGE-VERSIONING.md. Do not add print/cash-drawer/order/payment
     * methods here without reviewing that doc's payload/security contract first.
     */
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
                "manufacturer" to Build.MANUFACTURER
            )
        )

        @JavascriptInterface
        fun getNetworkStatus(): String = bridgeResponse(mapOf("online" to isNetworkAvailable()))

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
}
