package com.cpipos.pos

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

/**
 * User-visible update notice for the explicitly opted-in modern Android runtime channel.
 *
 * The server offers only the current latest Modern release. This helper additionally rejects
 * offers that are not explicitly marked latest, are not newer than the installed version, or
 * request mandatory/silent behavior. Installation remains operator initiated.
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
        val latest = offer.optBoolean("latest", false)

        // Fail closed. CpIPOS Modern accepts only a newer, explicitly latest, notice-only offer.
        if (channel != MODERN_CHANNEL || mandatory || !latest) return
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

            val dialog = AlertDialog.Builder(activity)
                .setView(buildUpdateCard(activity, versionName))
                .setPositiveButton("อัปเดตเป็น v$versionName") { _, _ ->
                    prefs.edit()
                        .putLong(nextPromptKey(versionCode), System.currentTimeMillis() + AFTER_OPEN_REPROMPT_MS)
                        .apply()
                    runCatching {
                        activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl)))
                    }
                }
                .setNegativeButton("ไว้ภายหลัง") { _, _ ->
                    prefs.edit()
                        .putLong(nextPromptKey(versionCode), System.currentTimeMillis() + DEFER_REPROMPT_MS)
                        .apply()
                }
                .setCancelable(true)
                .create()

            dialog.setOnShowListener {
                dialog.getButton(AlertDialog.BUTTON_POSITIVE)?.apply {
                    setTextColor(Color.rgb(2, 44, 34))
                    setTypeface(typeface, Typeface.BOLD)
                    background = roundedBackground(Color.rgb(110, 231, 183), 12f)
                    setPadding(dp(activity, 16), 0, dp(activity, 16), 0)
                }
                dialog.getButton(AlertDialog.BUTTON_NEGATIVE)?.apply {
                    setTextColor(Color.rgb(203, 213, 225))
                    setTypeface(typeface, Typeface.BOLD)
                }
            }
            dialog.show()
        }
    }

    private fun buildUpdateCard(context: Context, versionName: String): LinearLayout {
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(context, 22), dp(context, 22), dp(context, 22), dp(context, 18))
            background = roundedBackground(Color.rgb(15, 23, 42), 22f, Color.rgb(51, 65, 85))
        }

        val badge = TextView(context).apply {
            text = "CPIPOS · MODERN UPDATE"
            setTextColor(Color.rgb(110, 231, 183))
            textSize = 12f
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.CENTER
            setPadding(dp(context, 12), dp(context, 7), dp(context, 12), dp(context, 7))
            background = roundedBackground(Color.rgb(6, 78, 59), 30f, Color.rgb(16, 185, 129))
        }
        card.addView(
            badge,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        )

        val title = TextView(context).apply {
            text = "เวอร์ชันล่าสุด v$versionName พร้อมแล้ว"
            setTextColor(Color.WHITE)
            textSize = 24f
            setTypeface(typeface, Typeface.BOLD)
            setPadding(0, dp(context, 18), 0, 0)
        }
        card.addView(title)

        val message = TextView(context).apply {
            text = "แนะนำให้อัปเดต CpIPOS Android POS เพื่อรับการปรับปรุงความเร็วการพิมพ์ ความเสถียรของ Print Agent และการแก้ไขล่าสุดของ Modern Runtime\n\nการติดตั้งจะเริ่มเมื่อคุณกดปุ่มอัปเดตเท่านั้น ระบบจะไม่ติดตั้งหรือรีสตาร์ตเครื่องเอง"
            setTextColor(Color.rgb(203, 213, 225))
            textSize = 15f
            setLineSpacing(0f, 1.18f)
            setPadding(0, dp(context, 12), 0, 0)
        }
        card.addView(message)

        val note = TextView(context).apply {
            text = "LATEST RELEASE  •  SIGNED APK  •  MANUAL INSTALL"
            setTextColor(Color.rgb(125, 211, 252))
            textSize = 11f
            setTypeface(typeface, Typeface.BOLD)
            setPadding(0, dp(context, 16), 0, 0)
        }
        card.addView(note)
        return card
    }

    private fun roundedBackground(
        fillColor: Int,
        radiusDp: Float,
        strokeColor: Int? = null
    ): GradientDrawable = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        setColor(fillColor)
        cornerRadius = radiusDp * hostContext.resources.displayMetrics.density
        if (strokeColor != null) setStroke(dp(hostContext, 1), strokeColor)
    }

    private fun dp(context: Context, value: Int): Int =
        (value * context.resources.displayMetrics.density).toInt().coerceAtLeast(1)

    private fun isTrustedDownloadUrl(value: String): Boolean {
        val uri = runCatching { Uri.parse(value) }.getOrNull() ?: return false
        return uri.scheme.equals("https", ignoreCase = true) &&
            uri.host.equals(BuildConfig.CPIPOS_ANDROID_POS_ALLOWED_HOST, ignoreCase = true) &&
            uri.path == MODERN_DOWNLOAD_PATH
    }

    private fun nextPromptKey(versionCode: Int) = "modern_update_next_prompt_at_ms:$versionCode"

    companion object {
        private const val PREFS_NAME = "cpipos_android_modern_update_notice_v2"
        private const val MODERN_CHANNEL = "modern"
        private const val MODERN_DOWNLOAD_PATH = "/download/android/modern-latest"
        private const val DEFER_REPROMPT_MS = 6 * 60 * 60 * 1000L
        private const val AFTER_OPEN_REPROMPT_MS = 60 * 60 * 1000L
    }
}
