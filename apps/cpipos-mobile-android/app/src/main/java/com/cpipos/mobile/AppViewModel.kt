package com.cpipos.mobile

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val api = CpiposApi(application)
    private val _state = MutableStateFlow(MobileUiState())
    val state: StateFlow<MobileUiState> = _state.asStateFlow()

    init {
        bootstrap()
    }

    fun bootstrap() {
        viewModelScope.launch {
            _state.update { it.copy(screen = EntryScreen.BOOT, loading = true, error = null) }
            try {
                val shift = api.currentShift()
                _state.update {
                    it.copy(
                        screen = EntryScreen.MAIN,
                        activeTab = if (shift == null) MainTab.SHIFT else MainTab.SALES,
                        currentShift = shift
                    )
                }
                refreshMainData()
            } catch (error: ApiException) {
                if (error.status == 401 || error.status == 403) {
                    api.clearLocalSession()
                    _state.value = MobileUiState(screen = EntryScreen.STORE)
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
        _state.update {
            it.copy(
                screen = EntryScreen.MAIN,
                currentShift = shift,
                activeTab = if (shift == null) MainTab.SHIFT else MainTab.SALES
            )
        }
        refreshMainData()
    }

    fun setTab(tab: MainTab) {
        _state.update { it.copy(activeTab = tab) }
        when (tab) {
            MainTab.ORDERS -> refreshOrders()
            MainTab.PRODUCTS -> refreshProducts()
            MainTab.MEMBERS -> refreshMembers(_state.value.memberSearch)
            MainTab.SHIFT -> refreshShift()
            else -> Unit
        }
    }

    fun refreshShift() = action {
        val shift = api.currentShift()
        _state.update { it.copy(currentShift = shift) }
    }

    fun openShift(openingCashText: String) = action {
        val openingCash = parseOptionalMoney(openingCashText, "เงินสดตั้งต้น")
        val shift = api.openShift(openingCash)
        _state.update {
            it.copy(
                currentShift = shift,
                activeTab = MainTab.SALES,
                notice = "เปิดกะเรียบร้อย"
            )
        }
        refreshMainData()
    }

    fun closeShift(closingCashText: String) = action {
        val closingCash = parseOptionalMoney(closingCashText, "เงินสดปิดกะ")
        api.closeShift(closingCash)
        _state.update {
            it.copy(
                currentShift = null,
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

        val order = api.createOrder(cart)
        if (requestedCash + 0.009 < order.total) {
            throw LocalInputException("ยอดจากเซิร์ฟเวอร์สูงกว่าจำนวนเงินที่รับ กรุณาตรวจสอบบิล ${order.orderNo}")
        }
        api.payCash(order, requestedCash)
        _state.update {
            it.copy(
                cart = emptyMap(),
                notice = "ชำระเงินบิล ${order.orderNo} เรียบร้อย ยอด ${money(order.total)} บาท"
            )
        }
        _state.update { it.copy(orders = api.orders()) }
    }

    fun checkoutTransfer() = action {
        val cart = _state.value.cart.filterValues { it > 0 }
        if (cart.isEmpty()) throw LocalInputException("ยังไม่มีสินค้าในตะกร้า")
        val order = api.createOrder(cart)
        api.payTransfer(order)
        _state.update {
            it.copy(
                cart = emptyMap(),
                notice = "บันทึกโอนเงินบิล ${order.orderNo} เรียบร้อย ยอด ${money(order.total)} บาท"
            )
        }
        _state.update { it.copy(orders = api.orders()) }
    }

    fun logout() = action {
        api.logout()
        _state.value = MobileUiState(screen = EntryScreen.STORE, notice = "ออกจากระบบแล้ว")
    }

    fun clearMessage() {
        _state.update { it.copy(error = null, notice = null) }
    }

    private suspend fun refreshMainData() {
        if (_state.value.currentShift == null) return
        val products = api.products()
        val orders = api.orders()
        _state.update { it.copy(products = products, orders = orders) }
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
                    api.clearLocalSession()
                    _state.value = MobileUiState(screen = EntryScreen.STORE, error = "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่")
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

    companion object {
        fun cartTotal(state: MobileUiState): Double {
            val products = state.products.associateBy { it.id }
            return state.cart.entries.sumOf { (productId, quantity) ->
                (products[productId]?.price ?: 0.0) * quantity
            }
        }

        fun money(value: Double): String = "%.2f".format(value)
    }
}

private class LocalInputException(override val message: String) : IllegalArgumentException(message)
