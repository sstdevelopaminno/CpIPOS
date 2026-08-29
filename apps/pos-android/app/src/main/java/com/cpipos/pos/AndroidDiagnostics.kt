package com.cpipos.pos

import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Process
import android.os.StatFs
import android.os.SystemClock
import java.net.InetSocketAddress
import java.net.Socket

class AndroidDiagnostics(context: Context) {
    private val appContext = context.applicationContext
    private val printerPrefs = appContext.getSharedPreferences("cpipos_tablet_pos_printer", Context.MODE_PRIVATE)
    private val devicePolicyManager = appContext.getSystemService(DevicePolicyManager::class.java)
    private val deviceAdminComponent = ComponentName(appContext, CpiposDeviceAdminReceiver::class.java)
    private var previousProcessCpuMs: Long? = null
    private var previousElapsedMs: Long? = null

    fun networkOnline(): Boolean {
        val manager = appContext.getSystemService(ConnectivityManager::class.java) ?: return false
        val network = manager.activeNetwork ?: return false
        val caps = manager.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    fun networkType(): String {
        val manager = appContext.getSystemService(ConnectivityManager::class.java) ?: return "unknown"
        val network = manager.activeNetwork ?: return "offline"
        val caps = manager.getNetworkCapabilities(network) ?: return "unknown"
        return when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            else -> "other"
        }
    }

    fun appMemoryMb(): Long {
        val runtime = Runtime.getRuntime()
        return ((runtime.totalMemory() - runtime.freeMemory()) / (1024 * 1024)).coerceAtLeast(0)
    }

    fun memoryPercent(): Double? {
        val manager = appContext.getSystemService(ActivityManager::class.java) ?: return null
        val info = ActivityManager.MemoryInfo()
        manager.getMemoryInfo(info)
        if (info.totalMem <= 0L) return null
        val used = (info.totalMem - info.availMem).coerceAtLeast(0L)
        return ((used.toDouble() / info.totalMem.toDouble()) * 100.0).coerceIn(0.0, 100.0)
    }

    @Synchronized
    fun processCpuPercent(): Double? {
        val cpuMs = Process.getElapsedCpuTime()
        val elapsedMs = SystemClock.elapsedRealtime()
        val previousCpu = previousProcessCpuMs
        val previousElapsed = previousElapsedMs
        previousProcessCpuMs = cpuMs
        previousElapsedMs = elapsedMs
        if (previousCpu == null || previousElapsed == null) return null
        val cpuDelta = (cpuMs - previousCpu).coerceAtLeast(0L)
        val wallDelta = (elapsedMs - previousElapsed).coerceAtLeast(1L)
        val cores = Runtime.getRuntime().availableProcessors().coerceAtLeast(1)
        return ((cpuDelta.toDouble() / wallDelta.toDouble()) * 100.0 / cores.toDouble()).coerceIn(0.0, 100.0)
    }

    fun totalStorageMb(): Long {
        val stat = StatFs(appContext.filesDir.absolutePath)
        return (stat.totalBytes / (1024 * 1024)).coerceAtLeast(0)
    }

    fun availableStorageMb(): Long {
        val stat = StatFs(appContext.filesDir.absolutePath)
        return (stat.availableBytes / (1024 * 1024)).coerceAtLeast(0)
    }

    fun storageUsedPercent(): Double? {
        val total = totalStorageMb()
        if (total <= 0L) return null
        val free = availableStorageMb().coerceAtMost(total)
        return (((total - free).toDouble() / total.toDouble()) * 100.0).coerceIn(0.0, 100.0)
    }

    fun batteryPercent(): Int? {
        val manager = appContext.getSystemService(BatteryManager::class.java) ?: return null
        val value = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return value.takeIf { it >= 0 }
    }

    fun isDeviceOwnerKnown(): Boolean? = devicePolicyManager?.isDeviceOwnerApp(appContext.packageName)

    fun isDeviceAdminActive(): Boolean = devicePolicyManager?.isAdminActive(deviceAdminComponent) == true

    fun printerHost(): String? = printerPrefs.getString("host", null)?.trim()?.takeIf { it.isNotBlank() }

    fun printerPort(): Int? = printerPrefs.getInt("port", 9100).takeIf { it in 1..65535 }

    fun savePrinter(host: String, port: Int) {
        printerPrefs.edit().putString("host", host.trim()).putInt("port", port).apply()
    }

    fun testPrinterConnection(timeoutMs: Int = 2500): PrinterDiagnostic {
        val host = printerHost()
        val port = printerPort()
        if (host == null || port == null) return PrinterDiagnostic(host, port, null, "printer_not_configured")
        return try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(host, port), timeoutMs)
            }
            PrinterDiagnostic(host, port, true, null)
        } catch (error: Exception) {
            PrinterDiagnostic(host, port, false, error.message ?: error::class.java.simpleName)
        }
    }
}
