package com.cpipos.pos

import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Staged, self-update coordinator for managed Modern Android POS builds.
 *
 * Security model:
 * - update handling is disabled in Stable builds unless the build explicitly opts in;
 * - only a server-issued `staged` offer is installable;
 * - manifest and APK URLs must start on the CpIPOS production host;
 * - the APK SHA-256 must match the signed release manifest;
 * - the APK package/version and signing certificate are verified before PackageInstaller sees it;
 * - Device Owner devices may install without operator interaction when Android permits it;
 * - non-Device-Owner devices fall back to Android's user-confirmed package installer.
 */
class AndroidUpdateManager(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val executor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "cpipos-android-updater").apply { isDaemon = true }
    }
    private val busy = AtomicBoolean(false)

    fun stop() {
        executor.shutdownNow()
    }

    fun handleOffer(offer: JSONObject?) {
        if (!BuildConfig.CPIPOS_MANAGED_UPDATER_ENABLED || offer == null) return

        val channel = offer.optString("channel", "").trim().lowercase()
        val installPolicy = offer.optString("install_policy", "notice_only").trim().lowercase()
        val targetVersionCode = offer.optInt("version_code", 0)
        val targetVersionName = offer.optString("version_name", "").trim()
        val manifestUrl = offer.optString("manifest_url", "").trim()
        val trustAnchor = offer.optString("signing_cert_sha256", "").normalizeSha256()

        if (channel != BuildConfig.CPIPOS_UPDATE_CHANNEL || targetVersionCode <= BuildConfig.VERSION_CODE) return
        if (targetVersionName.isBlank() || offer.optBoolean("mandatory", false)) {
            recordState("rejected", targetVersionCode, targetVersionName, "unsafe_offer_contract")
            return
        }
        if (trustAnchor != BuildConfig.CPIPOS_ANDROID_UPDATE_SIGNING_CERT_SHA256.normalizeSha256()) {
            recordState("rejected", targetVersionCode, targetVersionName, "signing_trust_anchor_mismatch")
            return
        }

        if (installPolicy != "staged") {
            recordState("available", targetVersionCode, targetVersionName, null)
            return
        }
        if (!isTrustedCpiposUrl(manifestUrl)) {
            recordState("rejected", targetVersionCode, targetVersionName, "manifest_url_not_trusted")
            return
        }

        val currentStatus = prefs.getString(KEY_STATUS, "idle") ?: "idle"
        val currentTarget = prefs.getInt(KEY_TARGET_VERSION_CODE, 0)
        val lastAttemptAt = prefs.getLong(KEY_LAST_ATTEMPT_AT, 0L)
        val sameTarget = currentTarget == targetVersionCode
        val now = System.currentTimeMillis()

        if (sameTarget && currentStatus in ACTIVE_STATES) return
        if (sameTarget && currentStatus == "awaiting_unknown_sources_permission") {
            if (!canRequestPackageInstalls() && now - lastAttemptAt < UNKNOWN_SOURCES_REPROMPT_MS) return
        }
        if (sameTarget && currentStatus == "failed" && now - lastAttemptAt < FAILED_RETRY_DELAY_MS) return
        if (!busy.compareAndSet(false, true)) return

        prefs.edit().putLong(KEY_LAST_ATTEMPT_AT, now).apply()
        executor.execute {
            try {
                processStagedOffer(
                    targetVersionCode = targetVersionCode,
                    targetVersionName = targetVersionName,
                    manifestUrl = manifestUrl,
                    expectedTrustAnchor = trustAnchor
                )
            } catch (error: Throwable) {
                recordState(
                    "failed",
                    targetVersionCode,
                    targetVersionName,
                    error.message?.take(220) ?: error.javaClass.simpleName
                )
            } finally {
                busy.set(false)
            }
        }
    }

    fun snapshot(): JSONObject {
        return JSONObject()
            .put("enabled", BuildConfig.CPIPOS_MANAGED_UPDATER_ENABLED)
            .put("channel", BuildConfig.CPIPOS_UPDATE_CHANNEL)
            .put("status", prefs.getString(KEY_STATUS, "idle"))
            .put("target_version_code", prefs.getInt(KEY_TARGET_VERSION_CODE, 0).takeIf { it > 0 })
            .put("target_version_name", prefs.getString(KEY_TARGET_VERSION_NAME, null))
            .put("last_error", prefs.getString(KEY_LAST_ERROR, null))
            .put("verified_sha256", prefs.getString(KEY_VERIFIED_SHA256, null))
            .put("install_mode", prefs.getString(KEY_INSTALL_MODE, null))
            .put("updated_at_ms", prefs.getLong(KEY_UPDATED_AT, 0L).takeIf { it > 0 })
            .put("device_owner", isDeviceOwner())
            .put("unknown_sources_allowed", canRequestPackageInstalls())
    }

    private fun processStagedOffer(
        targetVersionCode: Int,
        targetVersionName: String,
        manifestUrl: String,
        expectedTrustAnchor: String
    ) {
        recordState("checking_manifest", targetVersionCode, targetVersionName, null)
        val manifest = fetchJson(manifestUrl)
        val manifestVersionCode = manifest.optInt("version_code", 0)
        val manifestVersionName = manifest.optString("version_name", "").trim()
        val manifestPackage = manifest.optString("package_name", "").trim()
        val manifestChannel = manifest.optString("channel", "").trim().lowercase()
        val downloadUrl = manifest.optString("download_url", "").trim()
        val expectedApkSha = manifest.optString("sha256", "").normalizeSha256()
        val manifestCertSha = manifest.optString("signing_cert_sha256", "").normalizeSha256()

        require(manifestVersionCode == targetVersionCode) { "manifest_version_code_mismatch" }
        require(manifestVersionName == targetVersionName) { "manifest_version_name_mismatch" }
        require(manifestPackage == BuildConfig.APPLICATION_ID) { "manifest_package_mismatch" }
        require(manifestChannel == BuildConfig.CPIPOS_UPDATE_CHANNEL) { "manifest_channel_mismatch" }
        require(expectedApkSha.matches(Regex("^[0-9a-f]{64}$"))) { "manifest_sha256_invalid" }
        require(manifestCertSha == expectedTrustAnchor) { "manifest_signing_cert_mismatch" }
        require(isTrustedCpiposUrl(downloadUrl)) { "apk_url_not_trusted" }

        recordState("downloading", targetVersionCode, targetVersionName, null)
        val apkFile = downloadApk(downloadUrl, targetVersionCode)
        val actualSha = sha256File(apkFile)
        require(actualSha == expectedApkSha) { "apk_sha256_mismatch" }

        recordState("verifying_apk", targetVersionCode, targetVersionName, null, verifiedSha = actualSha)
        verifyApkArchive(
            apkFile = apkFile,
            targetVersionCode = targetVersionCode,
            targetVersionName = targetVersionName,
            expectedSigningCertSha256 = expectedTrustAnchor
        )

        if (!isDeviceOwner() && !canRequestPackageInstalls()) {
            recordState(
                "awaiting_unknown_sources_permission",
                targetVersionCode,
                targetVersionName,
                null,
                verifiedSha = actualSha,
                installMode = "interactive"
            )
            launchUnknownSourcesSettings()
            return
        }

        commitInstall(
            apkFile = apkFile,
            targetVersionCode = targetVersionCode,
            targetVersionName = targetVersionName,
            verifiedSha = actualSha
        )
    }

    private fun fetchJson(url: String): JSONObject {
        val connection = openConnection(url, connectTimeoutMs = 8_000, readTimeoutMs = 8_000)
        try {
            val status = connection.responseCode
            require(status in 200..299) { "manifest_http_$status" }
            val text = connection.inputStream.bufferedReader().use { reader ->
                val value = reader.readText()
                require(value.length <= MAX_MANIFEST_CHARS) { "manifest_too_large" }
                value
            }
            return JSONObject(text)
        } finally {
            connection.disconnect()
        }
    }

    private fun downloadApk(url: String, targetVersionCode: Int): File {
        val updateDir = File(appContext.cacheDir, "cpipos-updates").apply { mkdirs() }
        val partial = File(updateDir, "cpipos-$targetVersionCode.apk.part")
        val target = File(updateDir, "cpipos-$targetVersionCode.apk")
        partial.delete()

        val connection = openConnection(url, connectTimeoutMs = 12_000, readTimeoutMs = 30_000)
        try {
            val status = connection.responseCode
            require(status in 200..299) { "apk_http_$status" }
            val declaredLength = connection.contentLengthLong
            require(declaredLength <= 0L || declaredLength <= MAX_APK_BYTES) { "apk_too_large" }

            var total = 0L
            connection.inputStream.use { input ->
                FileOutputStream(partial).use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        require(total <= MAX_APK_BYTES) { "apk_too_large" }
                        output.write(buffer, 0, count)
                    }
                    output.fd.sync()
                }
            }
            require(total >= MIN_APK_BYTES) { "apk_too_small" }
            target.delete()
            require(partial.renameTo(target)) { "apk_stage_rename_failed" }
            return target
        } finally {
            connection.disconnect()
            if (partial.exists()) partial.delete()
        }
    }

    @Suppress("DEPRECATION")
    private fun verifyApkArchive(
        apkFile: File,
        targetVersionCode: Int,
        targetVersionName: String,
        expectedSigningCertSha256: String
    ) {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            PackageManager.GET_SIGNATURES
        }
        val info = appContext.packageManager.getPackageArchiveInfo(apkFile.absolutePath, flags)
            ?: error("apk_archive_unreadable")
        require(info.packageName == BuildConfig.APPLICATION_ID) { "apk_package_mismatch" }

        val archiveVersionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode
        } else {
            info.versionCode.toLong()
        }
        require(archiveVersionCode == targetVersionCode.toLong()) { "apk_version_code_mismatch" }
        require(info.versionName == targetVersionName) { "apk_version_name_mismatch" }

        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.signingInfo?.apkContentsSigners.orEmpty()
        } else {
            info.signatures.orEmpty()
        }
        require(signatures.isNotEmpty()) { "apk_signature_missing" }
        val trusted = signatures.any { signature ->
            sha256Bytes(signature.toByteArray()) == expectedSigningCertSha256
        }
        require(trusted) { "apk_signing_certificate_mismatch" }
    }

    private fun commitInstall(
        apkFile: File,
        targetVersionCode: Int,
        targetVersionName: String,
        verifiedSha: String
    ) {
        val deviceOwner = isDeviceOwner()
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(BuildConfig.APPLICATION_ID)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && deviceOwner) {
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
        }
        val installer = appContext.packageManager.packageInstaller
        val sessionId = installer.createSession(params)
        val session = installer.openSession(sessionId)
        try {
            FileInputStream(apkFile).use { input ->
                session.openWrite("base.apk", 0, apkFile.length()).use { output ->
                    input.copyTo(output)
                    session.fsync(output)
                }
            }

            val installMode = if (deviceOwner) "device_owner" else "interactive"
            recordState(
                "install_committed",
                targetVersionCode,
                targetVersionName,
                null,
                verifiedSha = verifiedSha,
                installMode = installMode
            )

            val callbackIntent = Intent(appContext, UpdateInstallReceiver::class.java).apply {
                action = INSTALL_RESULT_ACTION
                putExtra(EXTRA_TARGET_VERSION_CODE, targetVersionCode)
                putExtra(EXTRA_TARGET_VERSION_NAME, targetVersionName)
                putExtra(EXTRA_VERIFIED_SHA256, verifiedSha)
                putExtra(EXTRA_INSTALL_MODE, installMode)
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
            val pendingIntent = PendingIntent.getBroadcast(
                appContext,
                targetVersionCode,
                callbackIntent,
                flags
            )
            session.commit(pendingIntent.intentSender)
        } finally {
            session.close()
        }
    }

    private fun launchUnknownSourcesSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        runCatching {
            val intent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${appContext.packageName}")
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            appContext.startActivity(intent)
        }
    }

    private fun openConnection(url: String, connectTimeoutMs: Int, readTimeoutMs: Int): HttpURLConnection {
        return (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            instanceFollowRedirects = true
            connectTimeout = connectTimeoutMs
            readTimeout = readTimeoutMs
            setRequestProperty("Accept", "application/json, application/vnd.android.package-archive, */*")
            setRequestProperty("User-Agent", "CpIPOS-AndroidPOS/${BuildConfig.VERSION_NAME}")
            setRequestProperty("X-CpIPOS-Android-POS", "true")
        }
    }

    private fun isTrustedCpiposUrl(value: String): Boolean {
        return runCatching {
            val url = URL(value)
            url.protocol.equals("https", ignoreCase = true) &&
                url.host.equals(BuildConfig.CPIPOS_ANDROID_POS_ALLOWED_HOST, ignoreCase = true)
        }.getOrDefault(false)
    }

    private fun isDeviceOwner(): Boolean {
        val manager = appContext.getSystemService(DevicePolicyManager::class.java) ?: return false
        return runCatching { manager.isDeviceOwnerApp(appContext.packageName) }.getOrDefault(false)
    }

    private fun canRequestPackageInstalls(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
        return runCatching { appContext.packageManager.canRequestPackageInstalls() }.getOrDefault(false)
    }

    private fun sha256File(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { byte -> "%02x".format(byte) }
    }

    private fun sha256Bytes(value: ByteArray): String {
        return MessageDigest.getInstance("SHA-256")
            .digest(value)
            .joinToString("") { byte -> "%02x".format(byte) }
    }

    private fun String.normalizeSha256(): String = trim().lowercase().replace(":", "")

    private fun recordState(
        status: String,
        targetVersionCode: Int,
        targetVersionName: String,
        error: String?,
        verifiedSha: String? = null,
        installMode: String? = null
    ) {
        val editor = prefs.edit()
            .putString(KEY_STATUS, status)
            .putInt(KEY_TARGET_VERSION_CODE, targetVersionCode)
            .putString(KEY_TARGET_VERSION_NAME, targetVersionName)
            .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
        if (error.isNullOrBlank()) editor.remove(KEY_LAST_ERROR) else editor.putString(KEY_LAST_ERROR, error)
        if (!verifiedSha.isNullOrBlank()) editor.putString(KEY_VERIFIED_SHA256, verifiedSha)
        if (!installMode.isNullOrBlank()) editor.putString(KEY_INSTALL_MODE, installMode)
        editor.apply()
    }

    companion object {
        const val INSTALL_RESULT_ACTION = "com.cpipos.pos.action.UPDATE_INSTALL_RESULT"
        const val EXTRA_TARGET_VERSION_CODE = "target_version_code"
        const val EXTRA_TARGET_VERSION_NAME = "target_version_name"
        const val EXTRA_VERIFIED_SHA256 = "verified_sha256"
        const val EXTRA_INSTALL_MODE = "install_mode"

        private const val PREFS_NAME = "cpipos_android_pos_update"
        private const val KEY_STATUS = "status"
        private const val KEY_TARGET_VERSION_CODE = "target_version_code"
        private const val KEY_TARGET_VERSION_NAME = "target_version_name"
        private const val KEY_LAST_ERROR = "last_error"
        private const val KEY_VERIFIED_SHA256 = "verified_sha256"
        private const val KEY_INSTALL_MODE = "install_mode"
        private const val KEY_UPDATED_AT = "updated_at_ms"
        private const val KEY_LAST_ATTEMPT_AT = "last_attempt_at_ms"

        private const val MAX_MANIFEST_CHARS = 32_768
        private const val MAX_APK_BYTES = 100L * 1024L * 1024L
        private const val MIN_APK_BYTES = 1L * 1024L * 1024L
        private const val FAILED_RETRY_DELAY_MS = 15L * 60L * 1000L
        private const val UNKNOWN_SOURCES_REPROMPT_MS = 30L * 60L * 1000L
        private val ACTIVE_STATES = setOf(
            "checking_manifest",
            "downloading",
            "verifying_apk",
            "install_committed",
            "awaiting_user_confirmation"
        )

        fun persistInstallerResult(
            context: Context,
            status: String,
            targetVersionCode: Int,
            targetVersionName: String?,
            error: String?,
            verifiedSha: String?,
            installMode: String?
        ) {
            val editor = context.applicationContext
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_STATUS, status)
                .putInt(KEY_TARGET_VERSION_CODE, targetVersionCode)
                .putString(KEY_TARGET_VERSION_NAME, targetVersionName)
                .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
            if (error.isNullOrBlank()) editor.remove(KEY_LAST_ERROR) else editor.putString(KEY_LAST_ERROR, error.take(220))
            if (!verifiedSha.isNullOrBlank()) editor.putString(KEY_VERIFIED_SHA256, verifiedSha)
            if (!installMode.isNullOrBlank()) editor.putString(KEY_INSTALL_MODE, installMode)
            editor.apply()
        }
    }
}
