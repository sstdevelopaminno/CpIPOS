package com.cpipos.pos

import org.json.JSONArray
import org.json.JSONObject

/**
 * Converts the structured kitchen payload into a complete text ticket for the fast native raster.
 * Returning null is deliberate: incomplete payloads must fall back to the existing HTML renderer.
 */
internal object NativeKitchenTicketFormatter {
    fun format(payloadText: String, payload: JSONObject): String? {
        val items = payload.optJSONArray("items") ?: return null
        if (items.length() <= 0) return null

        val lines = mutableListOf<String>()
        lines += "ใบสั่งอาหารเข้าครัว"
        clean(payload.optString("store_name", ""))?.let { lines += it }

        val zone = clean(payload.optString("zone_code", ""))
        if (zone != null) lines += "โซน: $zone"

        val queueNo = valueText(payload, "queue_no")
        val roundNo = valueText(payload, "round_no")
        val tableLabel = clean(payload.optString("table_label", ""))
        val queueParts = mutableListOf<String>()
        if (queueNo != null) queueParts += "คิว $queueNo"
        if (roundNo != null) queueParts += "รอบ $roundNo"
        if (tableLabel != null) queueParts += "โต๊ะ $tableLabel"
        if (queueParts.isNotEmpty()) lines += queueParts.joinToString(" | ")

        clean(payloadText)?.let { summary ->
            if (!lines.any { it == summary }) lines += summary
        }
        lines += "------------------------------------------"

        for (index in 0 until items.length()) {
            val item = items.optJSONObject(index) ?: return null
            val name = clean(item.optString("product_name", "")) ?: return null
            val quantity = item.optDouble("quantity", Double.NaN)
            if (!quantity.isFinite() || quantity <= 0.0) return null
            val quantityText = if (quantity % 1.0 == 0.0) quantity.toInt().toString() else trimDecimal(quantity)
            val action = clean(item.optString("action", ""))?.lowercase()
            val actionLabel = when (action) {
                "void", "cancel", "cancelled", "deleted" -> " [ยกเลิก]"
                "update", "updated", "change", "changed" -> " [แก้ไข]"
                else -> ""
            }
            lines += "$quantityText x $name$actionLabel"
            clean(item.optString("notes", ""))?.let { lines += "  หมายเหตุ: $it" }
        }

        lines += "------------------------------------------"
        clean(payload.optString("kitchen_ticket_id", ""))?.let { lines += "ใบครัว: $it" }
        return lines.joinToString("\n")
    }

    private fun valueText(payload: JSONObject, key: String): String? {
        if (!payload.has(key) || payload.isNull(key)) return null
        val value = payload.opt(key) ?: return null
        return when (value) {
            is Number -> {
                val number = value.toDouble()
                if (!number.isFinite()) null else if (number % 1.0 == 0.0) number.toLong().toString() else trimDecimal(number)
            }
            else -> clean(value.toString())
        }
    }

    private fun trimDecimal(value: Double): String =
        String.format(java.util.Locale.US, "%.3f", value).trimEnd('0').trimEnd('.')

    private fun clean(value: String?): String? = value?.trim()?.takeIf { it.isNotEmpty() }
}
