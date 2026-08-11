package com.cpipos.pos

import android.Manifest
import android.annotation.SuppressLint
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private var mdmAgent: PosMdmAgent? = null
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = filePathCallback
        filePathCallback = null
        callback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
    }

    private val permissionsLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        mdmAgent?.executeSafeCommand("collect_diagnostics", "runtime_permissions")
    }

    private val deviceAdminLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        mdmAgent?.executeSafeCommand("collect_diagnostics", "device_admin_enrollment")
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.loadsImagesAutomatically = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = true
            settings.userAgentString = buildString {
                append(settings.userAgentString)
                append(" CpIPOS-AndroidPOS/")
                append(BuildConfig.VERSION_NAME)
                append(" POS-WebView-Wrapper MDM-Ready")
            }

            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    webView: WebView?,
                    callback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?
                ): Boolean {
                    if (callback == null) return false

                    filePathCallback?.onReceiveValue(null)
                    filePathCallback = callback

                    val acceptTypes = fileChooserParams?.acceptTypes
                        ?.map { it.trim() }
                        ?.filter { it.isNotBlank() && it != "*/*" }
                        ?.distinct()
                        .orEmpty()

                    val pickerIntent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = if (acceptTypes.size == 1) acceptTypes.first() else "*/*"
                        if (acceptTypes.size > 1) {
                            putExtra(Intent.EXTRA_MIME_TYPES, acceptTypes.toTypedArray())
                        }
                        putExtra(
                            Intent.EXTRA_ALLOW_MULTIPLE,
                            fileChooserParams?.mode == FileChooserParams.MODE_OPEN_MULTIPLE
                        )
                    }

                    return runCatching {
                        fileChooserLauncher.launch(pickerIntent)
                        true
                    }.getOrElse {
                        filePathCallback?.onReceiveValue(null)
                        filePathCallback = null
                        false
                    }
                }
            }
        }

        val agent = PosMdmAgent(this, webView)
        mdmAgent = agent
        webView.addJavascriptInterface(agent, "CpiposMdm")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val uri = request.url
                return if (isAllowedWebUri(uri)) {
                    false
                } else {
                    openExternalUri(uri)
                    true
                }
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                mdmAgent?.notifyPageStarted(url)
            }

            override fun onPageFinished(view: WebView, url: String?) {
                super.onPageFinished(view, url)
                mdmAgent?.notifyPageFinished(url)
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                super.onReceivedError(view, request, error)
                if (request.isForMainFrame) {
                    mdmAgent?.notifyPageError(request.url?.toString(), error.description?.toString())
                }
            }
        }

        setContentView(webView)
        registerBackNavigation()
        agent.start()
        requestRuntimeCapabilities()
        requestDeviceAdminEnrollmentOnce()

        if (savedInstanceState == null) {
            webView.loadUrl(BuildConfig.CPIPOS_POS_WEB_URL)
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) webView.onResume()
    }

    override fun onPause() {
        if (::webView.isInitialized) webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        mdmAgent?.stop()
        mdmAgent = null
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }

    private fun requestRuntimeCapabilities() {
        val requested = buildList {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                add(Manifest.permission.BLUETOOTH_SCAN)
                add(Manifest.permission.BLUETOOTH_CONNECT)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                add(Manifest.permission.NEARBY_WIFI_DEVICES)
            }
        }.filter { permission ->
            ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED
        }

        if (requested.isNotEmpty()) {
            permissionsLauncher.launch(requested.toTypedArray())
        }
    }

    private fun requestDeviceAdminEnrollmentOnce() {
        val manager = getSystemService(DevicePolicyManager::class.java) ?: return
        val component = ComponentName(this, CpiposDeviceAdminReceiver::class.java)
        if (manager.isAdminActive(component)) return

        val prefs = getSharedPreferences("cpipos_android_pos_mdm", Context.MODE_PRIVATE)
        if (prefs.getBoolean("device_admin_prompted", false)) return
        prefs.edit().putBoolean("device_admin_prompted", true).apply()

        val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
            putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, component)
            putExtra(
                DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                getString(R.string.device_admin_description)
            )
        }
        runCatching { deviceAdminLauncher.launch(intent) }
    }

    private fun registerBackNavigation() {
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (::webView.isInitialized && webView.canGoBack()) {
                        webView.goBack()
                    } else {
                        finish()
                    }
                }
            }
        )
    }

    private fun isAllowedWebUri(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") return false
        return uri.host.equals(BuildConfig.CPIPOS_ANDROID_POS_ALLOWED_HOST, ignoreCase = true)
    }

    private fun openExternalUri(uri: Uri) {
        runCatching {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        }
    }
}
