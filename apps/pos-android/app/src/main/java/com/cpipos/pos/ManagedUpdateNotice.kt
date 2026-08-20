package com.cpipos.pos

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import org.json.JSONObject

/**
 * User-visible update notice for the explicitly opted-in modern Android runtime channel.
 *
 * This helper never downloads or installs an APK silently. It only opens CpIPOS' trusted
 * HTTPS download route after the operator chooses "Update now". Legacy runtimes do not
 * advertise the modern update capability and therefore never receive this notice.
 */
internal class ManagedUpdateNotice(
    context: Context,
    private val webView: WebView
) {
    private val hostContext = context
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile private var shownVersionCode: Int? = null

    fun applyOffer(offer: JSONObject?) {
        if (offer == null) return

        val channel = offer.optString("channel", "").trim().lowercase()
        val versionCode = offer.optInt("version_code", -1)
        val versionName = offer.optString("version_name", "").trim()
        val downloadUrl = offer.optString("download_url", "").trim()
        val mandatory = offer.optBoolean("mandatory", false)

        // Fail closed: this runtime intentionally supports notice-only updates on the modern
        // channel. A future server-side forced-update flag is ignored by this release.
        if (channel != MODERN_CHANNEL || mandatory) return
        if (versionCode <= BuildConfig.VERSION_CODE || versionName.isBlank()) return
        if (!isTrustedDownloadUrl(downloadUrl)) return
        if (shownVersionCode == versionCode) return

        val now = System.currentTimeMillis()
        if (now < prefs.getLong(nextPromptKey(versionCode), 0L)) return

        mainHandler.post {
            val activity = hostContext as? Activity ?: webView.context as? Activity ?: return@post
            if (activity.isFinishing || activity.isDestroyed) return@post
            if (shownVersionCode == versionCode) return@post
            shownVersionCode = versionCode

            AlertDialog.Builder(activity)
                .setTitle("มี CpIPOS เวอร์ชันใหม่ $versionName")
                .setMessage(
                    "มีอัปเดตสำหรับ Android POS สาย Modern แล้ว คุณสามารถอัปเดตตอนนี้หรือเลือกภายหลังได้ " +
                        "ระบบจะไม่บังคับติดตั้งและจะไม่รีสตาร์ตเครื่องอัตโนมัติ"
                )
                .setPositiveButton("อัปเดตตอนนี้") { _, _ ->
                    prefs.edit()
                        .putLong(nextPromptKey(versionCode), System.currentTimeMillis() + AFTER_OPEN_REPROMPT_MS)
                        .apply()
                    runCatching {
                        activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl)))
                    }
                }
                .setNegativeButton("ภายหลัง") { _, _ ->
                    prefs.edit()
                        .putLong(nextPromptKey(versionCode), System.currentTimeMillis() + DEFER_REPROMPT_MS)
                        .apply()
                }
                .setCancelable(true)
                .show()
        }
    }

    private fun isTrustedDownloadUrl(value: String): Boolean {
        val uri = runCatching { Uri.parse(value) }.getOrNull() ?: return false
        return uri.scheme.equals("https", ignoreCase = true) &&
            uri.host.equals(BuildConfig.CPIPOS_ANDROID_POS_ALLOWED_HOST, ignoreCase = true) &&
            uri.path == MODERN_DOWNLOAD_PATH
    }

    private fun nextPromptKey(versionCode: Int) = "modern_update_next_prompt_at_ms:$versionCode"

    companion object {
        private const val PREFS_NAME = "cpipos_android_modern_update_notice_v1"
        private const val MODERN_CHANNEL = "modern"
        private const val MODERN_DOWNLOAD_PATH = "/download/android/modern-latest"
        private const val DEFER_REPROMPT_MS = 6 * 60 * 60 * 1000L
        private const val AFTER_OPEN_REPROMPT_MS = 60 * 60 * 1000L
    }
}
