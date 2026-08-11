package com.cpipos.pos

import android.app.admin.DeviceAdminReceiver

/**
 * Android managed-device enrollment endpoint for CpIPOS POS terminals.
 *
 * Device Admin can be activated interactively. Android Enterprise Device Owner
 * provisioning is performed by IT during managed-device enrollment. Destructive
 * device-wide actions are intentionally not exposed through the app-level MDM
 * heartbeat; they require the authenticated/audited IT Admin control plane.
 */
class CpiposDeviceAdminReceiver : DeviceAdminReceiver()
