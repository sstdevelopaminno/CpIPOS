package com.cpipos.pos

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
    val price: Double,
    val isActive: Boolean = true,
    val stockOnHandUnits: Double? = null,
    val isOutOfStock: Boolean = false
)

data class DiningTable(
    val id: String,
    val code: String,
    val name: String,
    val zoneName: String?,
    val status: String,
    val activeSessionId: String?,
    val hasQrActivity: Boolean
)

data class BuffetPlan(
    val id: String,
    val code: String,
    val name: String,
    val mode: String,
    val price: Double
)

data class ReceiptSummary(
    val orderNo: String,
    val total: Double,
    val paymentMethod: String,
    val cashReceived: Double? = null,
    val changeAmount: Double? = null,
    val items: List<ReceiptLine> = emptyList()
)

data class ReceiptLine(
    val name: String,
    val quantity: Int,
    val unitPrice: Double
)

data class OrderSummary(
    val id: String,
    val orderNo: String,
    val orderType: String,
    val total: Double,
    val status: String,
    val createdAt: String
)



data class PrinterDiagnostic(
    val host: String?,
    val port: Int?,
    val reachable: Boolean?,
    val lastError: String?
)

data class PendingDeviceAction(
    val id: String,
    val commandType: String,
    val issuedAt: String
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
    TABLES,
    BUFFET,
    ORDERS,
    PRODUCTS,
    MEMBERS,
    SHIFT,
    SETTINGS
}

data class TabletPosUiState(
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
    val availableOpenShifts: List<PosShift> = emptyList(),
    val products: List<Product> = emptyList(),
    val tables: List<DiningTable> = emptyList(),
    val selectedTableId: String? = null,
    val buffetPlans: List<BuffetPlan> = listOf(
        BuffetPlan("buffet-per-person-299", "BUFFET299", "Buffet per person", "per_person", 299.0),
        BuffetPlan("buffet-set-999", "BUFFET999", "Buffet set", "set", 999.0)
    ),
    val orders: List<OrderSummary> = emptyList(),
    val members: List<Member> = emptyList(),
    val memberSearch: String = "",
    val cart: Map<String, Int> = emptyMap(),
    val receipt: ReceiptSummary? = null
)
