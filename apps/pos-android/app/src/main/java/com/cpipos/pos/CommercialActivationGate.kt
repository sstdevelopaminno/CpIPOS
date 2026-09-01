package com.cpipos.pos

import android.Manifest
import android.app.ActivityManager
import android.app.AlertDialog
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Native commercial-activation gate for managed Android POS installations.
 *
 * The server is authoritative. A required policy is cached locally so restarting the app or
 * temporarily losing network access cannot dismiss the gate. On Device Owner installations the
 * gate also enters Android LockTask mode. Non-Device-Owner installations cannot reliably prevent
 * the customer from leaving this app; for those devices the gate remains app-blocking and an
 * ongoing high-importance notification is shown instead.
 */
class CommercialActivationGateController(
    private val activity: ComponentActivity,
    private val installIdProvider: () -> String,
    private val onConfirmed: () -> Unit
) {
    private val prefs = activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val confirming = AtomicBoolean(false)
    private var dialog: AlertDialog? = null
    private var gateStartedLockTask = false

    fun updateFromHeartbeat(gate: JSONObject?) {
        if (gate == null) return
        val required = gate.optBoolean("required", false) && gate.optBoolean("blocking", false)
        if (!required) {
            clearCachedPolicy()
            activity.runOnUiThread { releaseGateUi() }
            return
        }

        val policyId = gate.optString("policy_id", "").trim()
        val effectiveDate = gate.optString("effective_date", "").trim()
        if (policyId.isBlank() || !EFFECTIVE_DATE_REGEX.matches(effectiveDate)) return

        prefs.edit()
            .putBoolean(KEY_REQUIRED, true)
            .putString(KEY_POLICY_ID, policyId)
            .putString(KEY_EFFECTIVE_DATE, effectiveDate)
            .putString(KEY_TITLE, gate.optString("title", DEFAULT_TITLE).ifBlank { DEFAULT_TITLE })
            .putString(KEY_MESSAGE, gate.optString("message", DEFAULT_MESSAGE).ifBlank { DEFAULT_MESSAGE })
            .putString(KEY_CONFIRM_LABEL, gate.optString("confirm_label", DEFAULT_CONFIRM_LABEL).ifBlank { DEFAULT_CONFIRM_LABEL })
            .putString(KEY_SUPPORT_HINT, gate.optString("support_hint", ""))
            .apply()

        postBlockingNotification(activity)
        activity.runOnUiThread { showIfRequired() }
    }

    fun isBlocking(): Boolean = prefs.getBoolean(KEY_REQUIRED, false)

    fun showIfRequired() {
        if (!isBlocking() || activity.isFinishing || activity.isDestroyed) return
        postBlockingNotification(activity)
        enforceManagedKioskIfAvailable()
        if (dialog?.isShowing == true) return

        val title = prefs.getString(KEY_TITLE, DEFAULT_TITLE).orEmpty().ifBlank { DEFAULT_TITLE }
        val message = buildString {
            append(prefs.getString(KEY_MESSAGE, DEFAULT_MESSAGE).orEmpty().ifBlank { DEFAULT_MESSAGE })
            val supportHint = prefs.getString(KEY_SUPPORT_HINT, "").orEmpty().trim()
            if (supportHint.isNotBlank()) {
                append("\n\n")
                append(supportHint)
            }
        }
        val confirmLabel = prefs.getString(KEY_CONFIRM_LABEL, DEFAULT_CONFIRM_LABEL).orEmpty().ifBlank { DEFAULT_CONFIRM_LABEL }

        dialog = AlertDialog.Builder(activity)
            .setTitle(title)
            .setMessage(message)
            .setCancelable(false)
            .setPositiveButton(confirmLabel, null)
            .create()
            .also { alert ->
                alert.setCanceledOnTouchOutside(false)
                alert.setOnShowListener {
                    alert.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                        confirmCurrentPolicy(alert)
                    }
                }
                alert.show()
            }
    }

    fun destroy() {
        dialog?.dismiss()
        dialog = null
    }

    private fun confirmCurrentPolicy(alert: AlertDialog) {
        if (!confirming.compareAndSet(false, true)) return

        val policyId = prefs.getString(KEY_POLICY_ID, "").orEmpty().trim()
        val effectiveDate = prefs.getString(KEY_EFFECTIVE_DATE, "").orEmpty().trim()
        if (policyId.isBlank() || !EFFECTIVE_DATE_REGEX.matches(effectiveDate)) {
            confirming.set(false)
            Toast.makeText(activity, "ไม่พบข้อมูลเปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ", Toast.LENGTH_LONG).show()
            return
        }

        val button = alert.getButton(AlertDialog.BUTTON_POSITIVE)
        val originalLabel = prefs.getString(KEY_CONFIRM_LABEL, DEFAULT_CONFIRM_LABEL).orEmpty().ifBlank { DEFAULT_CONFIRM_LABEL }
        button.isEnabled = false
        button.text = "กำลังยืนยัน…"

        activity.lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                postConfirmation(policyId, effectiveDate)
            }
            confirming.set(false)

            if (result.first) {
                clearCachedPolicy()
                releaseGateUi()
                onConfirmed()
                return@launch
            }

            button.isEnabled = true
            button.text = originalLabel
            Toast.makeText(
                activity,
                result.second ?: "ยังไม่สามารถยืนยันได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    private fun postConfirmation(policyId: String, effectiveDate: String): Pair<Boolean, String?> {
        return runCatching {
            val endpoint = BuildConfig.CPIPOS_API_BASE_URL.trimEnd('/') + "/api/android-pos/commercial-activation/confirm"
            val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 6_500
                readTimeout = 6_500
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Accept", "application/json")
                setRequestProperty("X-CpIPOS-Android-POS", "true")
                setRequestProperty("X-CpIPOS-Install-Id", installIdProvider())
                setRequestProperty("X-CpIPOS-App-Version", BuildConfig.VERSION_NAME)
            }
            val body = JSONObject()
                .put("policy_id", policyId)
                .put("effective_date", effectiveDate)
                .toString()
            connection.outputStream.use { output -> output.write(body.toByteArray(Charsets.UTF_8)) }

            val status = connection.responseCode
            val responseText = if (status in 200..299) {
                connection.inputStream.bufferedReader().use { it.readText() }
            } else {
                connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
            }
            connection.disconnect()

            val response = responseText.takeIf { it.isNotBlank() }?.let(::JSONObject)
            if (status in 200..299 && response?.optJSONObject("data")?.optBoolean("confirmed", false) == true) {
                true to null
            } else {
                val code = response?.optJSONObject("error")?.optString("code", "").orEmpty()
                false to when (code) {
                    "commercial_activation_policy_mismatch" -> "ข้อมูลเปิดใช้งานมีการเปลี่ยนแปลง กรุณารอสักครู่แล้วลองอีกครั้ง"
                    "commercial_activation_not_effective" -> "ยังไม่ถึงวันเริ่มเปิดใช้งานแพ็กเกจ"
                    "commercial_activation_device_not_found" -> "เครื่องนี้ยังไม่ผูกกับ MDM กรุณาติดต่อผู้ดูแลระบบ"
                    else -> "ยืนยันไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง"
                }
            }
        }.getOrElse {
            false to "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง"
        }
    }

    private fun enforceManagedKioskIfAvailable() {
        val manager = activity.getSystemService(DevicePolicyManager::class.java) ?: return
        if (!manager.isDeviceOwnerApp(activity.packageName)) return

        val admin = ComponentName(activity, CpiposDeviceAdminReceiver::class.java)
        runCatching {
            val currentPackages = manager.getLockTaskPackages(admin).toMutableSet()
            if (currentPackages.add(activity.packageName)) {
                manager.setLockTaskPackages(admin, currentPackages.toTypedArray())
            }
            val activityManager = activity.getSystemService(ActivityManager::class.java)
            if (activityManager?.lockTaskModeState == ActivityManager.LOCK_TASK_MODE_NONE) {
                activity.startLockTask()
                gateStartedLockTask = true
            }
        }
    }

    private fun releaseGateUi() {
        dialog?.dismiss()
        dialog = null
        cancelBlockingNotification(activity)
        if (gateStartedLockTask) {
            runCatching { activity.stopLockTask() }
            gateStartedLockTask = false
        }
    }

    private fun clearCachedPolicy() {
        prefs.edit()
            .remove(KEY_REQUIRED)
            .remove(KEY_POLICY_ID)
            .remove(KEY_EFFECTIVE_DATE)
            .remove(KEY_TITLE)
            .remove(KEY_MESSAGE)
            .remove(KEY_CONFIRM_LABEL)
            .remove(KEY_SUPPORT_HINT)
            .apply()
    }

    companion object {
        private const val PREFS_NAME = "cpipos_commercial_activation"
        private const val KEY_REQUIRED = "required"
        private const val KEY_POLICY_ID = "policy_id"
        private const val KEY_EFFECTIVE_DATE = "effective_date"
        private const val KEY_TITLE = "title"
        private const val KEY_MESSAGE = "message"
        private const val KEY_CONFIRM_LABEL = "confirm_label"
        private const val KEY_SUPPORT_HINT = "support_hint"
        private const val CHANNEL_ID = "cpipos_commercial_activation"
        private const val NOTIFICATION_ID = 91001
        private const val DEFAULT_TITLE = "ยืนยันเปิดใช้งาน SST iPOS"
        private const val DEFAULT_MESSAGE = "กรุณายืนยันการเริ่มใช้งานแพ็กเกจก่อนใช้งานระบบบนเครื่องนี้"
        private const val DEFAULT_CONFIRM_LABEL = "ยืนยันเปิดใช้งาน"
        private val EFFECTIVE_DATE_REGEX = Regex("^\\d{4}-\\d{2}-\\d{2}$")

        fun hasCachedBlockingPolicy(context: Context): Boolean =
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getBoolean(KEY_REQUIRED, false)

        fun postBlockingNotification(context: Context) {
            if (!hasCachedBlockingPolicy(context)) return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) return

            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                manager.createNotificationChannel(
                    NotificationChannel(
                        CHANNEL_ID,
                        "SST iPOS activation",
                        NotificationManager.IMPORTANCE_HIGH
                    ).apply {
                        description = "แจ้งเตือนการยืนยันเปิดใช้งานแพ็กเกจ SST iPOS"
                        setShowBadge(true)
                    }
                )
            }

            val intent = Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra("cpipos_show_commercial_activation", true)
            }
            val pendingIntent = PendingIntent.getActivity(
                context,
                NOTIFICATION_ID,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle(prefs.getString(KEY_TITLE, DEFAULT_TITLE).orEmpty().ifBlank { DEFAULT_TITLE })
                .setContentText(prefs.getString(KEY_MESSAGE, DEFAULT_MESSAGE).orEmpty().ifBlank { DEFAULT_MESSAGE })
                .setStyle(NotificationCompat.BigTextStyle().bigText(
                    prefs.getString(KEY_MESSAGE, DEFAULT_MESSAGE).orEmpty().ifBlank { DEFAULT_MESSAGE }
                ))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(pendingIntent)
                .build()
            manager.notify(NOTIFICATION_ID, notification)
        }

        fun cancelBlockingNotification(context: Context) {
            context.getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
        }
    }
}

/** Re-publishes a cached activation gate after reboot. Device Owner installs may relaunch POS. */
class CommercialActivationBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_LOCKED_BOOT_COMPLETED) return
        if (!CommercialActivationGateController.hasCachedBlockingPolicy(context)) return

        CommercialActivationGateController.postBlockingNotification(context)

        val manager = context.getSystemService(DevicePolicyManager::class.java)
        if (manager?.isDeviceOwnerApp(context.packageName) == true) {
            runCatching {
                context.startActivity(
                    Intent(context, MainActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                        putExtra("cpipos_show_commercial_activation", true)
                    }
                )
            }
        }
    }
}
