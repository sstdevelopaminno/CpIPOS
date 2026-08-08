package com.cpipos.pos

import android.content.Context
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import org.json.JSONArray
import org.json.JSONObject

class PersistentCookieJar(context: Context) : CookieJar {
    private val preferences = context.getSharedPreferences("cpipos_tablet_pos_http_cookies", Context.MODE_PRIVATE)
    private val storageKey = "cookies"

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val now = System.currentTimeMillis()
        val current = readCookies()
            .filter { it.expiresAt > now }
            .associateBy { keyOf(it) }
            .toMutableMap()

        for (cookie in cookies) {
            val key = keyOf(cookie)
            if (cookie.expiresAt <= now) {
                current.remove(key)
            } else {
                current[key] = cookie
            }
        }
        writeCookies(current.values.toList())
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        val all = readCookies()
        val valid = all.filter { it.expiresAt > now }
        if (valid.size != all.size) {
            writeCookies(valid)
        }
        return valid.filter { it.matches(url) }
    }

    @Synchronized
    fun clear() {
        preferences.edit().remove(storageKey).apply()
    }

    private fun keyOf(cookie: Cookie): String = "${cookie.name}|${cookie.domain}|${cookie.path}"

    private fun writeCookies(cookies: List<Cookie>) {
        val array = JSONArray()
        cookies.forEach { cookie ->
            array.put(
                JSONObject()
                    .put("name", cookie.name)
                    .put("value", cookie.value)
                    .put("domain", cookie.domain)
                    .put("path", cookie.path)
                    .put("expiresAt", cookie.expiresAt)
                    .put("secure", cookie.secure)
                    .put("httpOnly", cookie.httpOnly)
                    .put("hostOnly", cookie.hostOnly)
            )
        }
        preferences.edit().putString(storageKey, array.toString()).apply()
    }

    private fun readCookies(): List<Cookie> {
        val raw = preferences.getString(storageKey, null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            buildList {
                for (index in 0 until array.length()) {
                    decodeCookie(array.optJSONObject(index))?.let(::add)
                }
            }
        }.getOrDefault(emptyList())
    }

    private fun decodeCookie(value: JSONObject?): Cookie? {
        if (value == null) return null
        return runCatching {
            val domain = value.getString("domain")
            val builder = Cookie.Builder()
                .name(value.getString("name"))
                .value(value.getString("value"))
                .path(value.optString("path", "/"))
                .expiresAt(value.optLong("expiresAt", Long.MAX_VALUE))

            if (value.optBoolean("hostOnly", true)) {
                builder.hostOnlyDomain(domain)
            } else {
                builder.domain(domain)
            }
            if (value.optBoolean("secure", false)) builder.secure()
            if (value.optBoolean("httpOnly", false)) builder.httpOnly()
            builder.build()
        }.getOrNull()
    }
}
