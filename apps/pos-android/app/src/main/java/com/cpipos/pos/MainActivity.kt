package com.cpipos.pos

import android.Manifest
import android.annotation.SuppressLint
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.display.DisplayManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Display
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
    private var printAgent: PosPrintAgent? = null
    private var commercialActivationGate: CommercialActivationGateController? = null
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var displayManager: DisplayManager? = null
    private var dualScreenPresentation: DualScreenPresentation? = null
    private var activeSecondaryDisplayId: Int? = null

    private val dualScreenDisplayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(displayId: Int) {
            syncDualScreenPresentation()
        }

        override fun onDisplayRemoved(displayId: Int) {
            syncDualScreenPresentation()
        }

        override fun onDisplayChanged(displayId: Int) {
            syncDualScreenPresentation()
        }
    }

    private val fileChooserLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = filePathCallback
        filePathCallback = null
        callback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
    }

    private val permissionsLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        CommercialActivationGateController.postBlockingNotification(this)
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
                append(" POS-WebView-Wrapper MDM-Ready Native-Print-Agent")
                if (BuildConfig.CPIPOS_DUAL_SCREEN_ENABLED) append(" Dual-Screen")
            }

            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    webView: WebView?,
                    callback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?
                ): Boolean {
                    if (commercialActivationGate?.isBlocking() == true) {
                        commercialActivationGate?.showIfRequired()
                        callback?.onReceiveValue(null)
                        return true
                    }
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
                            fileChooserParams?.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE
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

        val agent = PosMdmAgent(this, webView) { activationGate ->
            commercialActivationGate?.updateFromHeartbeat(activationGate)
        }
        mdmAgent = agent
        commercialActivationGate = CommercialActivationGateController(
            activity = this,
            installIdProvider = { agent.installId },
            onConfirmed = {
                mdmAgent?.executeSafeCommand("collect_diagnostics", "commercial_activation_confirmed")
                if (::webView.isInitialized) {
                    if (webView.url.isNullOrBlank()) webView.loadUrl(BuildConfig.CPIPOS_POS_WEB_URL) else webView.reload()
                }
            }
        )
        webView.addJavascriptInterface(agent, "CpiposMdm")

        val nativePrintAgent = PosPrintAgent(this, agent.installId)
        printAgent = nativePrintAgent
        webView.addJavascriptInterface(nativePrintAgent, "CpiposPrint")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                if (commercialActivationGate?.isBlocking() == true) {
                    commercialActivationGate?.showIfRequired()
                    return true
                }
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
                applyCustomerDisplayV2Flag()
                CookieManager.getInstance().flush()
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
        commercialActivationGate?.showIfRequired()
        agent.start()
        nativePrintAgent.start()
        requestRuntimeCapabilities()
        requestDeviceAdminEnrollmentOnce()
        startDualScreenSupport()

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
        commercialActivationGate?.showIfRequired()
        syncDualScreenPresentation()
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        if (::webView.isInitialized) webView.onPause()
        super.onPause()
    }

    override fun onStop() {
        CookieManager.getInstance().flush()
        super.onStop()
    }

    override fun onDestroy() {
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        stopDualScreenSupport()
        printAgent?.stop()
        printAgent = null
        mdmAgent?.stop()
        mdmAgent = null
        commercialActivationGate?.destroy()
        commercialActivationGate = null
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }

    private fun startDualScreenSupport() {
        if (!BuildConfig.CPIPOS_DUAL_SCREEN_ENABLED) return
        val manager = getSystemService(DisplayManager::class.java) ?: return
        displayManager = manager
        manager.registerDisplayListener(dualScreenDisplayListener, Handler(Looper.getMainLooper()))
        syncDualScreenPresentation()
    }

    private fun stopDualScreenSupport() {
        val manager = displayManager
        if (manager != null && BuildConfig.CPIPOS_DUAL_SCREEN_ENABLED) {
            runCatching { manager.unregisterDisplayListener(dualScreenDisplayListener) }
        }
        displayManager = null
        dualScreenPresentation?.dismiss()
        dualScreenPresentation = null
        activeSecondaryDisplayId = null
    }

    private fun syncDualScreenPresentation() {
        if (!BuildConfig.CPIPOS_DUAL_SCREEN_ENABLED) return
        val manager = displayManager ?: return
        val primaryDisplayId = if (::webView.isInitialized) webView.display?.displayId ?: Display.DEFAULT_DISPLAY else Display.DEFAULT_DISPLAY
        val presentationDisplay = manager.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION)
            .firstOrNull { it.displayId != primaryDisplayId && it.state != Display.STATE_OFF }
        val secondaryDisplay = presentationDisplay ?: manager.displays
            .firstOrNull { it.displayId != primaryDisplayId && it.state != Display.STATE_OFF }

        if (secondaryDisplay == null) {
            dualScreenPresentation?.dismiss()
            dualScreenPresentation = null
            activeSecondaryDisplayId = null
            applyCustomerDisplayV2Flag()
            return
        }

        if (activeSecondaryDisplayId == secondaryDisplay.displayId && dualScreenPresentation?.isShowing == true) {
            applyCustomerDisplayV2Flag()
            return
        }

        dualScreenPresentation?.dismiss()
        dualScreenPresentation = null
        activeSecondaryDisplayId = null

        runCatching {
            DualScreenPresentation(
                this,
                secondaryDisplay,
                BuildConfig.CPIPOS_CUSTOMER_DISPLAY_V2_URL
            ).also { presentation ->
                presentation.show()
                dualScreenPresentation = presentation
                activeSecondaryDisplayId = secondaryDisplay.displayId
            }
        }.onFailure {
            dualScreenPresentation = null
            activeSecondaryDisplayId = null
        }

        applyCustomerDisplayV2Flag()
        mdmAgent?.executeSafeCommand("collect_diagnostics", "dual_screen_changed")
    }

    private fun applyCustomerDisplayV2Flag() {
        if (!::webView.isInitialized) return
        val enabled = BuildConfig.CPIPOS_DUAL_SCREEN_ENABLED && activeSecondaryDisplayId != null
        val value = if (enabled) "1" else "0"
        val script = """
            (function(){
              try {
                localStorage.setItem('pos_customer_display_v2_enabled_v001', '$value');
              } catch (_) {}
            })();
        """.trimIndent()
        webView.evaluateJavascript(script, null)
    }

    private fun requestRuntimeCapabilities() {
        val requested = buildList {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                add(Manifest.permission.BLUETOOTH_SCAN)
                add(Manifest.permission.BLUETOOTH_CONNECT)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                add(Manifest.permission.NEARBY_WIFI_DEVICES)
                add(Manifest.permission.POST_NOTIFICATIONS)
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
                    if (commercialActivationGate?.isBlocking() == true) {
                        commercialActivationGate?.showIfRequired()
                        return
                    }
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
        if (commercialActivationGate?.isBlocking() == true) {
            commercialActivationGate?.showIfRequired()
            return
        }
        runCatching {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        }
    }
}
