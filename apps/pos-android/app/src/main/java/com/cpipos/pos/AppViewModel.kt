package com.cpipos.pos

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val api = CpiposApi(application)
    private var heartbeatJob: Job? = null
    private val _state = MutableStateFlow(TabletPosUiState())
    val state: StateFlow<TabletPosUiState> = _state.asStateFlow()

    init {
        bootstrap()
    }

    fun bootstrap() {
        viewModelScope.launch {
            _state.update { it.copy(screen = EntryScreen.BOOT, loading = true, error = null) }
            try {
                val shift = api.currentShift()
                val openShifts = if (shift == null) api.availableOpenShifts() else emptyList()
                _state.update {
                    it.copy(
                        screen = EntryScreen.MAIN,
                        activeTab = if (shift == null) MainTab.SHIFT else MainTab.SALES,
                        currentShift = shift,
                        availableOpenShifts = openShifts
                    )
                }
                refreshMainData()
                startMdmHeartbeat()
            } catch (error: ApiException) {
                if (error.status == 401 || error.status == 403) {
                    stopMdmHeartbeat()
                    api.clearLocalSession()
                    _state.value = TabletPosUiState(screen = EntryScreen.STORE)
                } else {
                    _state.update { it.copy(screen = EntryScreen.STORE, error = error.message) }
                }
            } finally {
                _state.update { it.copy(loading = false) }
            }
        }
    }

    fun verifyStore(storeCode: String) = action {
        if (storeCode.isBlank()) throw LocalInputException("กรุณากรอกรหัสร้านค้า")
        val result = api.verifyStore(storeCode.trim())
        _state.update {
            it.copy(
                tenantName = result.tenantName,
                tenantCode = result.tenantCode,
                branches = result.branches,
                screen = if (result.nextStep == "employee" || result.autoSkipBranchSelection) EntryScreen.EMPLOYEE else EntryScreen.BRANCH
            )
        }
    }

    fun selectBranch(branch: Branch) = action {
        api.selectBranch(branch.id)
        _state.update { it.copy(screen = EntryScreen.EMPLOYEE) }
    }

    fun verifyEmployee(employeeCode: String) = action {
        if (employeeCode.isBlank()) throw LocalInputException("กรุณากรอกรหัสพนักงาน")
        val employee = api.verifyEmployee(employeeCode.trim())
        val devices = api.loadDevices()
        _state.update {
            it.copy(
                employee = employee,
                devices = devices,
                screen = EntryScreen.DEVICE
            )
        }
    }

    fun refreshDevices() = action {
        _state.update { it.copy(devices = api.loadDevices()) }
    }

    fun selectDevice(device: PosDevice, forceOverride: Boolean = false) = action {
        api.selectDevice(device.code, forceOverride)
        val shift = api.currentShift()
        val openShifts = if (shift == null) api.availableOpenShifts() else emptyList()
        _state.update {
            it.copy(
                screen = EntryScreen.MAIN,
                currentShift = shift,
                availableOpenShifts = openShifts,
                activeTab = if (shift == null) MainTab.SHIFT else MainTab.SALES
            )
        }
        refreshMainData()
        startMdmHeartbeat()
    }

    fun setTab(tab: MainTab) {
        _state.update { it.copy(activeTab = tab) }
        when (tab) {
            MainTab.TABLES -> refreshTables()
            MainTab.BUFFET -> refreshProducts()
            MainTab.ORDERS -> refreshOrders()
            MainTab.PRODUCTS -> refreshProducts()
            MainTab.MEMBERS -> refreshMembers(_state.value.memberSearch)
            MainTab.SHIFT -> refreshShift()
            else -> Unit
        }
    }

    fun refreshShift() = action {
        val shift = api.currentShift()
        val openShifts = if (shift == null) api.availableOpenShifts() else emptyList()
        _state.update { it.copy(currentShift = shift, availableOpenShifts = openShifts) }
    }

    fun openShift(openingCashText: String) = action {
        val openingCash = parseOptionalMoney(openingCashText, "เงินสดตั้งต้น")
        val shift = api.openShift(openingCash)
        _state.update {
            it.copy(
                currentShift = shift,
                availableOpenShifts = emptyList(),
                activeTab = MainTab.SALES,
                notice = "เปิดกะเรียบร้อย"
            )
        }
        refreshMainData()
    }


    fun joinShift(shiftId: String) = action {
        if (shiftId.isBlank()) throw LocalInputException("กรุณาเลือกกะ")
        val shift = api.joinShift(shiftId)
        _state.update {
            it.copy(
                currentShift = shift,
                availableOpenShifts = emptyList(),
                activeTab = MainTab.SALES,
                notice = "เข้ากะเรียบร้อย"
            )
        }
        refreshMainData()
    }

    fun savePrinter(host: String, portText: String) = action {
        val port = portText.toIntOrNull() ?: throw LocalInputException("พอร์ตเครื่องพิมพ์ไม่ถูกต้อง")
        if (host.isBlank()) throw LocalInputException("กรุณากรอก IP/ที่อยู่เครื่องพิมพ์")
        api.savePrinterConfig(host, port)
        _state.update { it.copy(notice = "บันทึกเครื่องพิมพ์แล้ว") }
    }

    fun testPrinter() = action {
        val result = api.testPrinterConnection()
        val message = when (result.reachable) {
            true -> "เชื่อมต่อเครื่องพิมพ์ ${result.host}:${result.port} สำเร็จ"
            false -> "เชื่อมต่อเครื่องพิมพ์ไม่สำเร็จ: ${result.lastError ?: "unknown"}"
            null -> "ยังไม่ได้ตั้งค่าเครื่องพิมพ์"
        }
        _state.update { it.copy(notice = message) }
    }    fun closeShift(closingCashText: String) = action {
        val closingCash = parseOptionalMoney(closingCashText, "เงินสดปิดกะ")
        api.closeShift(closingCash)
        _state.update {
            it.copy(
                currentShift = null,
                availableOpenShifts = emptyList(),
                cart = emptyMap(),
                activeTab = MainTab.SHIFT,
                notice = "ปิดกะเรียบร้อย"
            )
        }
    }

    fun refreshProducts() = action {
        if (_state.value.currentShift == null) return@action
        _state.update { it.copy(products = api.products()) }
    }

    fun refreshTables() = action {
        if (_state.value.currentShift == null) return@action
        _state.update { it.copy(tables = api.tables()) }
    }

    fun selectTable(table: DiningTable) = action {
        if (table.status == "disabled" || table.status == "reserved") {
            throw LocalInputException("Table is not available")
        }
        if (table.activeSessionId.isNullOrBlank()) {
            api.openTableBill(table.id)
        }
        _state.update {
            it.copy(selectedTableId = table.id, activeTab = MainTab.SALES, notice = "Selected table ${table.name}")
        }
        _state.update { it.copy(tables = runCatching { api.tables() }.getOrDefault(it.tables)) }
    }

    fun clearSelectedTable() {
        _state.update { it.copy(selectedTableId = null) }
    }

    fun addBuffet(plan: BuffetPlan, quantity: Int) = action {
        if (quantity <= 0) throw LocalInputException("Quantity is required")
        val productId = api.resolveBuffetProduct(plan)
        if (_state.value.products.none { it.id == productId }) {
            _state.update { it.copy(products = it.products + Product(productId, plan.name, plan.code, "Buffet", plan.price)) }
        }
        val current = _state.value.cart.toMutableMap()
        current[productId] = (current[productId] ?: 0) + quantity
        _state.update { it.copy(cart = current, activeTab = MainTab.SALES, notice = "Added ${plan.name}") }
    }

    fun clearReceipt() {
        _state.update { it.copy(receipt = null) }
    }

    fun refreshOrders() = action {
        if (_state.value.currentShift == null) return@action
        _state.update { it.copy(orders = api.orders()) }
    }

    fun refreshMembers(query: String = _state.value.memberSearch) = action {
        if (_state.value.currentShift == null) return@action
        val cleaned = query.trim()
        _state.update { it.copy(memberSearch = cleaned, members = api.members(cleaned)) }
    }

    fun saveMember(name: String, phone: String, email: String) = action {
        if (name.isBlank()) throw LocalInputException("กรุณากรอกชื่อสมาชิก")
        if (!phone.filter(Char::isDigit).matches(Regex("\\d{9,10}"))) {
            throw LocalInputException("กรุณากรอกเบอร์โทร 9-10 หลัก")
        }
        api.saveMember(name.trim(), phone.filter(Char::isDigit), email.trim())
        _state.update { it.copy(notice = "บันทึกสมาชิกเรียบร้อย") }
        _state.update { it.copy(members = api.members(_state.value.memberSearch)) }
    }

    fun addToCart(productId: String) {
        val product = _state.value.products.firstOrNull { it.id == productId }
        if (product?.isOutOfStock == true) return
        val current = _state.value.cart.toMutableMap()
        current[productId] = (current[productId] ?: 0) + 1
        _state.update { it.copy(cart = current) }
    }

    fun decreaseCart(productId: String) {
        val current = _state.value.cart.toMutableMap()
        val next = (current[productId] ?: 0) - 1
        if (next <= 0) current.remove(productId) else current[productId] = next
        _state.update { it.copy(cart = current) }
    }

    fun clearCart() {
        _state.update { it.copy(cart = emptyMap()) }
    }

    fun checkoutCash(cashReceivedText: String) = action {
        val cart = _state.value.cart.filterValues { it > 0 }
        if (cart.isEmpty()) throw LocalInputException("ยังไม่มีสินค้าในตะกร้า")
        val localTotal = cartTotal(_state.value)
        val requestedCash = if (cashReceivedText.isBlank()) localTotal else parseRequiredMoney(cashReceivedText, "จำนวนเงินที่รับ")
        if (requestedCash + 0.009 < localTotal) {
            throw LocalInputException("จำนวนเงินที่รับน้อยกว่ายอดขาย")
        }

        val receiptItems = receiptLines(_state.value, cart)
        val tableId = _state.value.selectedTableId
        val order = api.createOrder(cart, if (tableId == null) "takeaway" else "dine_in", tableId)
        if (requestedCash + 0.009 < order.total) {
            throw LocalInputException("ยอดจากเซิร์ฟเวอร์สูงกว่าจำนวนเงินที่รับ กรุณาตรวจสอบบิล ${order.orderNo}")
        }
        api.payCash(order, requestedCash)
        _state.update {
            it.copy(
                cart = emptyMap(),
                selectedTableId = null,
                receipt = ReceiptSummary(order.orderNo, order.total, "cash", requestedCash, (requestedCash - order.total).coerceAtLeast(0.0), receiptItems),
                notice = "Paid bill ${order.orderNo} ${money(order.total)}"
            )
        }
        _state.update { it.copy(orders = api.orders(), tables = runCatching { api.tables() }.getOrDefault(it.tables)) }
    }

    fun checkoutTransfer() = action {
        val cart = _state.value.cart.filterValues { it > 0 }
        if (cart.isEmpty()) throw LocalInputException("ยังไม่มีสินค้าในตะกร้า")
        val receiptItems = receiptLines(_state.value, cart)
        val tableId = _state.value.selectedTableId
        val order = api.createOrder(cart, if (tableId == null) "takeaway" else "dine_in", tableId)
        api.payTransfer(order)
        _state.update {
            it.copy(
                cart = emptyMap(),
                selectedTableId = null,
                receipt = ReceiptSummary(order.orderNo, order.total, "bank_transfer", items = receiptItems),
                notice = "Paid transfer bill ${order.orderNo} ${money(order.total)}"
            )
        }
        _state.update { it.copy(orders = api.orders(), tables = runCatching { api.tables() }.getOrDefault(it.tables)) }
    }


    private fun startMdmHeartbeat() {
        if (heartbeatJob?.isActive == true) return
        heartbeatJob = viewModelScope.launch {
            var reason = "startup"
            while (true) {
                val actions = runCatching { api.sendDeviceHeartbeat(reason) }.getOrDefault(emptyList())
                handleMdmCommands(actions)
                reason = "interval"
                delay(5 * 60 * 1000L)
            }
        }
    }


    private fun stopMdmHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = null
    }

    private fun handleMdmCommands(actions: List<PendingDeviceAction>) {
        if (actions.isEmpty()) return
        actions.forEach { action ->
            when (action.commandType) {
                "reload_ui", "refresh_config", "restart_app" -> bootstrap()
                "request_diagnostics_bundle", "request_diagnostics", "test_network" -> viewModelScope.launch { runCatching { api.sendDeviceHeartbeat(action.commandType) } }
                "test_printer" -> viewModelScope.launch { runCatching { api.testPrinterConnection() } }
                "disable_device", "enable_device", "clear_print_queue", "restart_local_bridge", "restart_print_service", "check_update" -> Unit
            }
        }
    }

    fun logout() = action {
        stopMdmHeartbeat()
        api.logout()
        _state.value = TabletPosUiState(screen = EntryScreen.STORE, notice = "ออกจากระบบแล้ว")
    }

    fun clearMessage() {
        _state.update { it.copy(error = null, notice = null) }
    }

    private suspend fun refreshMainData() {
        if (_state.value.currentShift == null) return
        val products = api.products()
        val orders = api.orders()
        val tables = runCatching { api.tables() }.getOrDefault(emptyList())
        _state.update { it.copy(products = products, orders = orders, tables = tables) }
    }

    private fun action(block: suspend () -> Unit) {
        if (_state.value.loading) return
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                block()
            } catch (error: LocalInputException) {
                _state.update { it.copy(error = error.message) }
            } catch (error: ApiException) {
                if (error.status == 401) {
                    stopMdmHeartbeat()
                    api.clearLocalSession()
                    _state.value = TabletPosUiState(screen = EntryScreen.STORE, error = "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่")
                } else {
                    _state.update { it.copy(error = error.message) }
                }
            } catch (error: Exception) {
                _state.update { it.copy(error = error.message ?: "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ") }
            } finally {
                _state.update { it.copy(loading = false) }
            }
        }
    }

    private fun parseOptionalMoney(text: String, field: String): Double? {
        if (text.isBlank()) return null
        return parseRequiredMoney(text, field)
    }

    private fun parseRequiredMoney(text: String, field: String): Double {
        val value = text.toDoubleOrNull()
        if (value == null || value < 0) throw LocalInputException("$field ไม่ถูกต้อง")
        return value
    }

    private fun receiptLines(state: TabletPosUiState, cart: Map<String, Int>): List<ReceiptLine> {
        val products = state.products.associateBy { it.id }
        return cart.mapNotNull { (productId, quantity) ->
            val product = products[productId] ?: return@mapNotNull null
            ReceiptLine(product.name, quantity, product.price)
        }
    }

    companion object {
        fun cartTotal(state: TabletPosUiState): Double {
            val products = state.products.associateBy { it.id }
            return state.cart.entries.sumOf { (productId, quantity) ->
                (products[productId]?.price ?: 0.0) * quantity
            }
        }

        fun money(value: Double): String = "%.2f".format(value)
    }
}

private class LocalInputException(override val message: String) : IllegalArgumentException(message)
