package com.cpipos.pos

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.StatFs
import java.net.InetSocketAddress
import java.net.Socket

data class PrinterDiagnostic(
    val host: String?,
    val port: Int?,
    val reachable: Boolean?,
    val error: String?
)

class AndroidDiagnostics(context: Context) {
    private val appContext = context.applicationContext
    private val printerPrefs = appContext.getSharedPreferences("cpipos_tablet_pos_printer", Context.MODE_PRIVATE)

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

    fun availableStorageMb(): Long {
        val stat = StatFs(appContext.filesDir.absolutePath)
        return (stat.availableBytes / (1024 * 1024)).coerceAtLeast(0)
    }

    fun batteryPercent(): Int? {
        val manager = appContext.getSystemService(BatteryManager::class.java) ?: return null
        val value = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return value.takeIf { it >= 0 }
    }

    fun isDeviceOwnerKnown(): Boolean? = if (Build.VERSION.SDK_INT >= 21) false else null

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
