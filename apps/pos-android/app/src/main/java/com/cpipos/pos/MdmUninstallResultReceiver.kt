package com.cpipos.pos

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import org.json.JSONObject

/**
 * Private PackageInstaller completion callback. No incoming network or exported
 * intent can mark an MDM uninstall successful. The next regular heartbeat sends
 * the persisted result to the primary MDM queue.
 */
class MdmUninstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val commandId = intent.getStringExtra("mdm_command_id").orEmpty().trim()
        val packageName = intent.getStringExtra("mdm_package_name").orEmpty().trim()
        val resultStatus = intent.getIntExtra(
            PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE
        )
        val succeeded = resultStatus == PackageInstaller.STATUS_SUCCESS
        val needsUserAction = resultStatus == PackageInstaller.STATUS_PENDING_USER_ACTION

        val result = JSONObject()
            .put("ok", succeeded)
            .put("action", "uninstall_app")
            .put("package_name", packageName.take(200))
            .put("installer_status", resultStatus)
            .put(
                "code", when {
                    succeeded -> "package_uninstalled"
                    needsUserAction -> "user_confirmation_required"
                    else -> "package_uninstall_failed"
                }
            )
            .put(
                "installer_message",
                intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)?.take(240)
                    ?: JSONObject.NULL
            )
            .put("executed_at_ms", System.currentTimeMillis())

        FullMdmAgent(context).recordAsyncResult(
            commandId,
            if (succeeded) "succeeded" else "failed",
            result
        )
    }
}
