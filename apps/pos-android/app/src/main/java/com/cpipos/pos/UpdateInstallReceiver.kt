package com.cpipos.pos

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build

/** Receives PackageInstaller state and opens Android's confirmation UI when required. */
class UpdateInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != AndroidUpdateManager.INSTALL_RESULT_ACTION) return

        val targetVersionCode = intent.getIntExtra(AndroidUpdateManager.EXTRA_TARGET_VERSION_CODE, 0)
        val targetVersionName = intent.getStringExtra(AndroidUpdateManager.EXTRA_TARGET_VERSION_NAME)
        val verifiedSha = intent.getStringExtra(AndroidUpdateManager.EXTRA_VERIFIED_SHA256)
        val installMode = intent.getStringExtra(AndroidUpdateManager.EXTRA_INSTALL_MODE)
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val statusMessage = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)

        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                AndroidUpdateManager.persistInstallerResult(
                    context = context,
                    status = "awaiting_user_confirmation",
                    targetVersionCode = targetVersionCode,
                    targetVersionName = targetVersionName,
                    error = null,
                    verifiedSha = verifiedSha,
                    installMode = installMode
                )
                val confirmationIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                }
                if (confirmationIntent != null) {
                    confirmationIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    runCatching { context.startActivity(confirmationIntent) }
                }
            }

            PackageInstaller.STATUS_SUCCESS -> {
                AndroidUpdateManager.persistInstallerResult(
                    context = context,
                    status = "installed",
                    targetVersionCode = targetVersionCode,
                    targetVersionName = targetVersionName,
                    error = null,
                    verifiedSha = verifiedSha,
                    installMode = installMode
                )
            }

            else -> {
                AndroidUpdateManager.persistInstallerResult(
                    context = context,
                    status = "failed",
                    targetVersionCode = targetVersionCode,
                    targetVersionName = targetVersionName,
                    error = "package_installer_status_${status}:${statusMessage.orEmpty()}".take(220),
                    verifiedSha = verifiedSha,
                    installMode = installMode
                )
            }
        }
    }
}
