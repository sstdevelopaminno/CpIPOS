package com.cpipos.mobile

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit

class ApiException(
    val status: Int,
    val code: String,
    override val message: String
) : IOException(message)

class CpiposApi(context: Context) {
    private val cookieJar = PersistentCookieJar(context.applicationContext)
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()
    private val baseUrl = BuildConfig.CPIPOS_API_BASE_URL.trimEnd('/')

    private val client = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(35, TimeUnit.SECONDS)
        .writeTimeout(35, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS)
        .build()

    suspend fun verifyStore(storeCode: String): StoreVerification {
        val root = post("/api/auth/store-code/verify", JSONObject().put("store_code", storeCode))
        val data = root.requiredDataObject()
        val tenant = data.optJSONObject("tenant") ?: JSONObject()
        val branchesJson = data.optJSONArray("branches") ?: JSONArray()
        val branches = buildList {
            for (index in 0 until branchesJson.length()) {
                val item = branchesJson.optJSONObject(index) ?: continue
                add(
                    Branch(
                        id = item.optString("id"),
                        code = item.optNullableString("code"),
                        name = item.optString("name", "-"),
                        address = item.optNullableString("address")
                    )
                )
            }
        }
        return StoreVerification(
            tenantName = tenant.optString("name", ""),
            tenantCode = tenant.optString("code", storeCode),
            branches = branches,
            nextStep = data.optString("next_step", "branches"),
            autoSkipBranchSelection = data.optBoolean("auto_skip_branch_selection", false)
        )
    }

    suspend fun selectBranch(branchId: String) {
        post("/api/auth/branches/select", JSONObject().put("branch_id", branchId))
    }

    suspend fun verifyEmployee(employeeCode: String): Employee {
        val data = post(
            "/api/auth/employee/verify-code",
            JSONObject().put("employee_code", employeeCode)
        ).requiredDataObject()
        val employee = data.optJSONObject("employee") ?: throw ApiException(500, "employee_missing", "ไม่พบข้อมูลพนักงานจากเซิร์ฟเวอร์")
        return Employee(
            id = employee.optString("id"),
            code = employee.optString("code"),
            name = employee.optString("name", "-"),
            role = employee.optString("role", "staff")
        )
    }

    suspend fun loadDevices(): List<PosDevice> {
        val data = get("/api/auth/devices").requiredDataObject()
        val devices = data.optJSONArray("devices") ?: JSONArray()
        return buildList {
            for (index in 0 until devices.length()) {
                val item = devices.optJSONObject(index) ?: continue
                val currentUser = item.optJSONObject("currentUser")
                add(
                    PosDevice(
                        id = item.optString("deviceId"),
                        code = item.optString("deviceCode"),
                        name = item.optString("deviceName", item.optString("deviceCode")),
                        counterName = item.optString("counterName", "-"),
                        status = item.optString("status", "unknown"),
                        currentUserName = currentUser?.optString("name")?.takeIf { it.isNotBlank() }
                    )
                )
            }
        }
    }

    suspend fun selectDevice(deviceCode: String, forceOverride: Boolean = false) {
        post(
            "/api/auth/devices/select",
            JSONObject()
                .put("device_code", deviceCode)
                .put("force_override", forceOverride)
        )
    }

    suspend fun currentShift(): PosShift? {
        val data = get("/api/pos/shifts/current").requiredDataObject()
        return data.optJSONObject("current_shift")?.toShift()
    }

    suspend fun openShift(openingCash: Double?): PosShift {
        val body = JSONObject()
        if (openingCash != null) body.put("opening_cash", openingCash)
        val data = post("/api/pos/shifts/open", body).requiredDataObject()
        return data.optJSONObject("shift")?.toShift()
            ?: throw ApiException(500, "shift_missing", "เซิร์ฟเวอร์ไม่ได้ส่งข้อมูลกะกลับมา")
    }

    suspend fun closeShift(closingCash: Double?): String {
        val body = JSONObject().put("quick_close", true)
        if (closingCash != null) body.put("closing_cash", closingCash)
        val data = post("/api/pos/shifts/close", body).requiredDataObject()
        return data.optString("shift_id")
    }

    suspend fun products(): List<Product> {
        val data = get("/api/pos/products").requiredDataObject()
        val rows = data.optJSONArray("products") ?: JSONArray()
        return buildList {
            for (index in 0 until rows.length()) {
                val item = rows.optJSONObject(index) ?: continue
                add(
                    Product(
                        id = item.optString("id"),
                        name = item.optString("name", "-"),
                        sku = item.optNullableString("sku"),
                        category = item.optNullableString("category"),
                        price = item.optDouble("price", 0.0)
                    )
                )
            }
        }
    }

    suspend fun orders(): List<OrderSummary> {
        val data = get("/api/pos/orders?page=1&page_size=50").requiredDataObject()
        val rows = data.optJSONArray("items") ?: JSONArray()
        return buildList {
            for (index in 0 until rows.length()) {
                val item = rows.optJSONObject(index) ?: continue
                add(
                    OrderSummary(
                        id = item.optString("id"),
                        orderNo = item.optString("order_no", "-"),
                        orderType = item.optString("order_type", "-"),
                        total = item.optDouble("grand_total", item.optDouble("total_amount", 0.0)),
                        status = item.optString("status", "-"),
                        createdAt = item.optString("created_at", "")
                    )
                )
            }
        }
    }

    suspend fun createOrder(items: Map<String, Int>): CreatedOrder {
        val bodyItems = JSONArray()
        items.filterValues { it > 0 }.forEach { (productId, quantity) ->
            bodyItems.put(
                JSONObject()
                    .put("product_id", productId)
                    .put("quantity", quantity)
            )
        }
        val data = post(
            "/api/pos/orders",
            JSONObject().put("items", bodyItems),
            idempotencyKey = UUID.randomUUID().toString()
        ).requiredDataObject()
        val order = data.optJSONObject("order")
            ?: throw ApiException(500, "order_missing", "เซิร์ฟเวอร์ไม่ได้ส่งข้อมูลบิลกลับมา")
        return CreatedOrder(
            id = order.optString("id"),
            orderNo = order.optString("order_no", "-"),
            total = order.optDouble(
                "grand_total",
                order.optDouble("subtotal", 0.0) - order.optDouble("discount_amount", 0.0)
            )
        )
    }

    suspend fun payCash(order: CreatedOrder, cashReceived: Double) {
        val paymentLines = JSONArray().put(
            JSONObject()
                .put("method", "cash")
                .put("amount", order.total)
        )
        post(
            "/api/pos/payments",
            JSONObject()
                .put("order_id", order.id)
                .put("payment_lines", paymentLines)
                .put("cash_received", cashReceived)
                .put("change_amount", (cashReceived - order.total).coerceAtLeast(0.0)),
            idempotencyKey = UUID.randomUUID().toString()
        )
    }

    suspend fun payTransfer(order: CreatedOrder) {
        val paymentLines = JSONArray().put(
            JSONObject()
                .put("method", "bank_transfer")
                .put("amount", order.total)
        )
        post(
            "/api/pos/payments",
            JSONObject()
                .put("order_id", order.id)
                .put("payment_lines", paymentLines)
                .put("skip_transfer_verification", true),
            idempotencyKey = UUID.randomUUID().toString()
        )
    }

    suspend fun members(query: String = ""): List<Member> {
        val encodedPath = if (query.isBlank()) {
            "/api/pos/members"
        } else {
            val url = "$baseUrl/api/pos/members".toHttpUrl().newBuilder()
                .addQueryParameter("q", query)
                .build()
            url.toString().removePrefix(baseUrl)
        }
        val data = get(encodedPath).requiredDataObject()
        val rows = data.optJSONArray("members") ?: JSONArray()
        return buildList {
            for (index in 0 until rows.length()) {
                val item = rows.optJSONObject(index) ?: continue
                add(
                    Member(
                        id = item.optString("id"),
                        name = item.optString("name", "-"),
                        phone = item.optString("phone", ""),
                        email = item.optString("email", ""),
                        points = item.optInt("points", 0),
                        stamps = item.optInt("stamps", 0)
                    )
                )
            }
        }
    }

    suspend fun saveMember(name: String, phone: String, email: String): Member {
        val data = post(
            "/api/pos/members",
            JSONObject()
                .put("name", name)
                .put("phone", phone)
                .put("email", email)
        ).requiredDataObject()
        val member = data.optJSONObject("member")
            ?: throw ApiException(500, "member_missing", "เซิร์ฟเวอร์ไม่ได้ส่งข้อมูลสมาชิกกลับมา")
        return Member(
            id = member.optString("id"),
            name = member.optString("name", "-"),
            phone = member.optString("phone", ""),
            email = member.optString("email", ""),
            points = member.optInt("points", 0),
            stamps = member.optInt("stamps", 0)
        )
    }

    suspend fun logout() {
        runCatching { post("/api/auth/session/logout", JSONObject()) }
        cookieJar.clear()
    }

    fun clearLocalSession() {
        cookieJar.clear()
    }

    private suspend fun get(path: String): JSONObject = request("GET", path, null, null)

    private suspend fun post(
        path: String,
        body: JSONObject,
        idempotencyKey: String? = null
    ): JSONObject = request("POST", path, body, idempotencyKey)

    private suspend fun request(
        method: String,
        path: String,
        body: JSONObject?,
        idempotencyKey: String?
    ): JSONObject = withContext(Dispatchers.IO) {
        val url = if (path.startsWith("http://") || path.startsWith("https://")) path else "$baseUrl$path"
        val builder = Request.Builder()
            .url(url)
            .header("Accept", "application/json")
            .header("User-Agent", "CpIPOSMobileNative/${BuildConfig.VERSION_NAME}")
            .header("X-CpIPOS-Client", "android-native-mobile")

        if (!idempotencyKey.isNullOrBlank()) {
            builder.header("X-Idempotency-Key", idempotencyKey)
        }

        if (method == "POST") {
            builder.post((body ?: JSONObject()).toString().toRequestBody(jsonMediaType))
        } else {
            builder.get()
        }

        try {
            client.newCall(builder.build()).execute().use { response ->
                val raw = response.body?.string().orEmpty()
                val root = if (raw.isBlank()) JSONObject() else runCatching { JSONObject(raw) }.getOrElse {
                    if (!response.isSuccessful) {
                        throw ApiException(response.code, "http_${response.code}", "เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (${response.code})")
                    }
                    JSONObject()
                }

                if (!response.isSuccessful) {
                    val error = root.optJSONObject("error")
                    throw ApiException(
                        response.code,
                        error?.optString("code", "http_${response.code}") ?: "http_${response.code}",
                        error?.optString("message", "เกิดข้อผิดพลาดจากเซิร์ฟเวอร์") ?: "เกิดข้อผิดพลาดจากเซิร์ฟเวอร์"
                    )
                }

                val error = root.optJSONObject("error")
                if (error != null) {
                    throw ApiException(
                        response.code,
                        error.optString("code", "api_error"),
                        error.optString("message", "เกิดข้อผิดพลาดจากเซิร์ฟเวอร์")
                    )
                }
                root
            }
        } catch (error: ApiException) {
            throw error
        } catch (error: IOException) {
            throw ApiException(0, "network_error", "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่")
        }
    }

    private fun JSONObject.requiredDataObject(): JSONObject {
        return optJSONObject("data")
            ?: throw ApiException(500, "invalid_response", "รูปแบบข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง")
    }

    private fun JSONObject.toShift(): PosShift = PosShift(
        id = optString("id"),
        status = optString("status", "open"),
        openedAt = optString("opened_at", ""),
        openingCash = if (has("opening_cash") && !isNull("opening_cash")) optDouble("opening_cash") else null,
        deviceCode = optNullableString("device_code")
    )

    private fun JSONObject.optNullableString(key: String): String? {
        if (!has(key) || isNull(key)) return null
        return optString(key).takeIf { it.isNotBlank() }
    }
}
