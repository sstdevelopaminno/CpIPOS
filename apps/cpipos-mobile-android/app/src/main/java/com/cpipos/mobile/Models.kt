package com.cpipos.mobile

data class Branch(
    val id: String,
    val code: String?,
    val name: String,
    val address: String?
)

data class StoreVerification(
    val tenantName: String,
    val tenantCode: String,
    val branches: List<Branch>,
    val nextStep: String,
    val autoSkipBranchSelection: Boolean
)

data class Employee(
    val id: String,
    val code: String,
    val name: String,
    val role: String
)

data class PosDevice(
    val id: String,
    val code: String,
    val name: String,
    val counterName: String,
    val status: String,
    val currentUserName: String?
)

data class PosShift(
    val id: String,
    val status: String,
    val openedAt: String,
    val openingCash: Double?,
    val deviceCode: String?
)

data class Product(
    val id: String,
    val name: String,
    val sku: String?,
    val category: String?,
    val price: Double
)

data class OrderSummary(
    val id: String,
    val orderNo: String,
    val orderType: String,
    val total: Double,
    val status: String,
    val createdAt: String
)

data class CreatedOrder(
    val id: String,
    val orderNo: String,
    val total: Double
)

data class Member(
    val id: String,
    val name: String,
    val phone: String,
    val email: String,
    val points: Int,
    val stamps: Int
)

enum class EntryScreen {
    BOOT,
    STORE,
    BRANCH,
    EMPLOYEE,
    DEVICE,
    MAIN
}

enum class MainTab {
    SALES,
    ORDERS,
    PRODUCTS,
    MEMBERS,
    SHIFT,
    SETTINGS
}

data class MobileUiState(
    val screen: EntryScreen = EntryScreen.BOOT,
    val activeTab: MainTab = MainTab.SALES,
    val loading: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
    val tenantName: String = "",
    val tenantCode: String = "",
    val branches: List<Branch> = emptyList(),
    val employee: Employee? = null,
    val devices: List<PosDevice> = emptyList(),
    val currentShift: PosShift? = null,
    val products: List<Product> = emptyList(),
    val orders: List<OrderSummary> = emptyList(),
    val members: List<Member> = emptyList(),
    val memberSearch: String = "",
    val cart: Map<String, Int> = emptyMap()
)
