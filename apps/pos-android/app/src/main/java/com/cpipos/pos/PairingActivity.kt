package com.cpipos.pos

import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors

/**
 * IT-assisted enrollment surface for a physical Android POS installation.
 *
 * The one-time activation token is typed/pasted locally and sent only in the
 * HTTPS request body. It is never placed in an Intent/deep-link URL or stored
 * in SharedPreferences. Approval remains an IT control-plane action.
 */
class PairingActivity : ComponentActivity() {
    private val executor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "cpipos-android-pairing").apply { isDaemon = true }
    }

    private lateinit var tokenInput: EditText
    private lateinit var deviceCodeInput: EditText
    private lateinit var submitButton: Button
    private lateinit var statusText: TextView
    private lateinit var installId: String

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        installId = getOrCreateInstallId()
        setContentView(buildContent())
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun buildContent(): ScrollView {
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(36), dp(28), dp(36), dp(28))
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }

        content.addView(TextView(this).apply {
            text = "CpIPOS · Device Enrollment"
            textSize = 26f
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            bottomMargin = dp(10)
        })

        content.addView(TextView(this).apply {
            text = "กรอก Pairing Token จาก IT Admin และรหัสเครื่อง POS\nเครื่องจะอยู่สถานะ Pending จนกว่า IT จะกด Approve"
            textSize = 16f
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            bottomMargin = dp(20)
        })

        tokenInput = EditText(this).apply {
            hint = "Pairing Token"
            isSingleLine = true
            setAutofillHints(null)
        }
        content.addView(tokenInput, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            bottomMargin = dp(12)
        })

        deviceCodeInput = EditText(this).apply {
            hint = "Device Code เช่น FF0001-POS-01"
            isSingleLine = true
        }
        content.addView(deviceCodeInput, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            bottomMargin = dp(16)
        })

        submitButton = Button(this).apply {
            text = "ส่งคำขอจับคู่"
            setOnClickListener { submitPairing() }
        }
        content.addView(submitButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            bottomMargin = dp(10)
        })

        content.addView(Button(this).apply {
            text = "กลับ POS"
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            bottomMargin = dp(18)
        })

        statusText = TextView(this).apply {
            text = "Install ID: …${installId.takeLast(8)}"
            textSize = 14f
        }
        content.addView(statusText, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        return ScrollView(this).apply {
            addView(content)
        }
    }

    private fun submitPairing() {
        val token = tokenInput.text?.toString()?.trim().orEmpty()
        val deviceCode = deviceCodeInput.text?.toString()?.trim()?.uppercase().orEmpty()
        if (token.length < 20) {
            statusText.text = "Pairing Token ไม่ถูกต้อง"
            return
        }
        if (!DEVICE_CODE_PATTERN.matches(deviceCode)) {
            statusText.text = "Device Code ไม่ถูกต้อง"
            return
        }

        submitButton.isEnabled = false
        statusText.text = "กำลังส่งคำขอจับคู่…"
        executor.execute {
            val result = runCatching { postPairing(token, deviceCode) }
                .getOrElse { error -> PairingResult(false, error.message ?: "pairing_request_failed", null) }
            runOnUiThread {
                submitButton.isEnabled = true
                if (result.ok) {
                    tokenInput.text?.clear()
                    getSharedPreferences(MDM_PREFS, MODE_PRIVATE).edit()
                        .putString("pending_pair_device_code", deviceCode)
                        .putLong("pending_pair_requested_at_ms", System.currentTimeMillis())
                        .apply()
                    statusText.text = buildString {
                        append("ส่งคำขอสำเร็จ · รอ IT Approve")
                        result.state?.let { append("\nสถานะ: ").append(it) }
                        append("\nDevice: ").append(deviceCode)
                        append("\nInstall ID: …").append(installId.takeLast(8))
                    }
                } else {
                    statusText.text = "จับคู่ไม่สำเร็จ: ${result.message}"
                }
            }
        }
    }

    private fun postPairing(token: String, deviceCode: String): PairingResult {
        val connection = (URL("${BuildConfig.CPIPOS_API_BASE_URL}/api/android-pos/mdm/pair").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 8_000
            readTimeout = 10_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Accept", "application/json")
            setRequestProperty("X-CpIPOS-Android-POS", "true")
            setRequestProperty("X-CpIPOS-Install-Id", installId)
            setRequestProperty("X-CpIPOS-App-Version", BuildConfig.VERSION_NAME)
        }

        val body = JSONObject()
            .put("activation_token", token)
            .put("android_install_id", installId)
            .put("device_code", deviceCode)
            .put("app_version", BuildConfig.VERSION_NAME)
            .put("runtime_version", "android-pos-webview-mdm-lite")

        connection.outputStream.use { output ->
            output.write(body.toString().toByteArray(Charsets.UTF_8))
        }

        val status = connection.responseCode
        val responseText = if (status in 200..299) {
            connection.inputStream.bufferedReader().use { it.readText() }
        } else {
            connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
        }
        connection.disconnect()

        val root = runCatching { JSONObject(responseText) }.getOrNull()
        val data = root?.optJSONObject("data")
        val error = root?.optJSONObject("error")
        val state = data?.optString("pairing_state", "")?.takeIf { it.isNotBlank() }
        val message = error?.optString("message", "")?.takeIf { it.isNotBlank() }
            ?: error?.optString("code", "")?.takeIf { it.isNotBlank() }
            ?: "HTTP $status"
        return PairingResult(status in 200..299 && data != null, message, state)
    }

    private fun getOrCreateInstallId(): String {
        val prefs = getSharedPreferences(MDM_PREFS, MODE_PRIVATE)
        val existing = prefs.getString(INSTALL_ID_KEY, null)?.trim()?.takeIf { it.isNotBlank() }
        if (existing != null) return existing
        val generated = UUID.randomUUID().toString()
        prefs.edit().putString(INSTALL_ID_KEY, generated).apply()
        return generated
    }

    private data class PairingResult(val ok: Boolean, val message: String, val state: String?)

    companion object {
        private const val MDM_PREFS = "cpipos_android_pos_mdm"
        private const val INSTALL_ID_KEY = "install_id"
        private val DEVICE_CODE_PATTERN = Regex("^[A-Z0-9_-]{2,64}$")
    }
}
