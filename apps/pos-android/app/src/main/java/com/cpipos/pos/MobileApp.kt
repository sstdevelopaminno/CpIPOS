package com.cpipos.pos

import androidx.compose.foundation.shape.RoundedCornerShape

import androidx.compose.foundation.clickable

import androidx.compose.foundation.background

import androidx.compose.foundation.BorderStroke

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

private val CpiposColors = lightColorScheme(
    primary = Color(0xFF075985),
    onPrimary = Color.White,
    secondary = Color(0xFF0F766E),
    surface = Color(0xFFF8FAFC),
    background = Color(0xFFF8FAFC),
    onSurface = Color(0xFF0F172A)
)

@Composable
fun CpiposTabletPosApp(viewModel: AppViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(state.error, state.notice) {
        val message = state.error ?: state.notice
        if (!message.isNullOrBlank()) {
            snackbar.showSnackbar(message)
            viewModel.clearMessage()
        }
    }

    MaterialTheme(colorScheme = CpiposColors) {
        Surface(modifier = Modifier.fillMaxSize()) {
            Box(modifier = Modifier.fillMaxSize()) {
                when (state.screen) {
                    EntryScreen.BOOT -> BootScreen()
                    EntryScreen.STORE -> StoreLoginScreen(state, viewModel)
                    EntryScreen.BRANCH -> BranchScreen(state, viewModel)
                    EntryScreen.EMPLOYEE -> EmployeeScreen(state, viewModel)
                    EntryScreen.DEVICE -> DeviceScreen(state, viewModel)
                    EntryScreen.MAIN -> MainShell(state, viewModel, snackbar)
                }

                if (state.loading) {
                    Surface(
                        modifier = Modifier.fillMaxSize(),
                        color = Color.White.copy(alpha = 0.72f)
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun BootScreen() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("CpIPOS Tablet POS", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            CircularProgressIndicator()
            Spacer(Modifier.height(12.dp))
            Text("กำลังตรวจสอบเซสชัน…")
        }
    }
}

@Composable
private fun AuthFrame(
    title: String,
    subtitle: String,
    content: @Composable () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .imePadding()
            .padding(horizontal = 22.dp, vertical = 32.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Text("CpIPOS Tablet POS", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
            Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Text(subtitle, color = Color(0xFF64748B))
            Spacer(Modifier.height(4.dp))
            content()
            Spacer(Modifier.height(8.dp))
            Text(
                "Native Android • native only",
                style = MaterialTheme.typography.labelMedium,
                color = Color(0xFF64748B)
            )
        }
    }
}

@Composable
private fun StoreLoginScreen(state: TabletPosUiState, viewModel: AppViewModel) {
    var code by rememberSaveable { mutableStateOf("") }
    AuthFrame(
        title = "เข้าสู่ระบบร้านค้า",
        subtitle = "ใช้รหัสร้านเดียวกับ CpIPOS บนระบบหลัก"
    ) {
        OutlinedTextField(
            value = code,
            onValueChange = { code = it.uppercase() },
            label = { Text("รหัสร้านค้า") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Button(
            onClick = { viewModel.verifyStore(code) },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("ตรวจสอบร้านค้า")
        }
        if (state.tenantName.isNotBlank()) {
            Text(state.tenantName, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun BranchScreen(state: TabletPosUiState, viewModel: AppViewModel) {
    AuthFrame(
        title = "เลือกสาขา",
        subtitle = state.tenantName.ifBlank { "เลือกร้านและสาขาที่ต้องการใช้งาน" }
    ) {
        if (state.branches.isEmpty()) {
            Text("ไม่พบสาขาที่เปิดใช้งาน")
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(360.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(state.branches, key = { it.id }) { branch ->
                    OutlinedCard(
                        onClick = { viewModel.selectBranch(branch) },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(Modifier.padding(16.dp)) {
                            Text(branch.name, fontWeight = FontWeight.SemiBold)
                            Text(branch.code ?: "-", color = Color(0xFF64748B))
                            branch.address?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun EmployeeScreen(state: TabletPosUiState, viewModel: AppViewModel) {
    var code by rememberSaveable { mutableStateOf("") }
    AuthFrame(
        title = "ยืนยันพนักงาน",
        subtitle = state.tenantName.ifBlank { "กรอกรหัสพนักงานของสาขา" }
    ) {
        OutlinedTextField(
            value = code,
            onValueChange = { code = it.filter(Char::isDigit).take(32) },
            label = { Text("รหัสพนักงาน") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Button(
            onClick = { viewModel.verifyEmployee(code) },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("เข้าสู่ระบบ")
        }
    }
}

@Composable
private fun DeviceScreen(state: TabletPosUiState, viewModel: AppViewModel) {
    AuthFrame(
        title = "เลือกเครื่อง",
        subtitle = state.employee?.let { "${it.name} • ${it.role}" } ?: "เลือกอุปกรณ์แคชเชียร์"
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("พบ ${state.devices.size} เครื่อง", modifier = Modifier.weight(1f))
            TextButton(onClick = viewModel::refreshDevices) { Text("รีเฟรช") }
        }
        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .height(380.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            items(state.devices, key = { it.code }) { device ->
                val canSelect = device.status.lowercase() !in setOf("disabled", "inactive", "maintenance", "offline")
                OutlinedCard(
                    onClick = { if (canSelect) viewModel.selectDevice(device) },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(16.dp)) {
                        Row {
                            Column(Modifier.weight(1f)) {
                                Text(device.name, fontWeight = FontWeight.SemiBold)
                                Text("${device.code} • ${device.counterName}", color = Color(0xFF64748B))
                            }
                            Text(device.status, style = MaterialTheme.typography.labelMedium)
                        }
                        device.currentUserName?.let {
                            Spacer(Modifier.height(4.dp))
                            Text("กำลังใช้งานโดย $it", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MainShell(
    state: TabletPosUiState,
    viewModel: AppViewModel,
    snackbar: SnackbarHostState
) {
    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("CpIPOS Tablet POS", fontWeight = FontWeight.Bold)
                        Text(
                            buildString {
                                if (state.tenantName.isNotBlank()) append(state.tenantName)
                                state.employee?.name?.let {
                                    if (isNotEmpty()) append(" - ")
                                    append(it)
                                }
                            },
                            style = MaterialTheme.typography.labelMedium,
                            color = Color(0xFF64748B)
                        )
                    }
                },
                actions = {
                    val shiftText = if (state.currentShift == null) "Shift closed" else "Shift open"
                    Text(
                        shiftText,
                        modifier = Modifier.padding(end = 14.dp),
                        color = if (state.currentShift == null) Color(0xFFB45309) else Color(0xFF047857),
                        fontWeight = FontWeight.SemiBold
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.White)
            )
        }
    ) { innerPadding ->
        Row(
            modifier = Modifier
                .padding(innerPadding)
                .fillMaxSize()
        ) {
            Column(
                modifier = Modifier
                    .fillMaxHeight()
                    .width(116.dp)
                    .padding(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                MainTab.entries.forEach { tab ->
                    val selected = state.activeTab == tab
                    Button(
                        onClick = { viewModel.setTab(tab) },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (selected) MaterialTheme.colorScheme.primary else Color(0xFFE2E8F0),
                            contentColor = if (selected) Color.White else Color(0xFF0F172A)
                        )
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(tab.shortLabel)
                            Text(tab.thaiLabel, maxLines = 1, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .weight(1f)
            ) {
                when (state.activeTab) {
                    MainTab.SALES -> SalesTab(state, viewModel)
                    MainTab.TABLES -> TablesTab(state, viewModel)
                    MainTab.BUFFET -> BuffetTab(state, viewModel)
                    MainTab.ORDERS -> OrdersTab(state, viewModel)
                    MainTab.PRODUCTS -> ProductsTab(state, viewModel)
                    MainTab.MEMBERS -> MembersTab(state, viewModel)
                    MainTab.SHIFT -> ShiftTab(state, viewModel)
                    MainTab.SETTINGS -> SettingsTab(state, viewModel)
                }
            }
        }
    }
}

@Composable
private fun SalesTab(state: TabletPosUiState, viewModel: AppViewModel) {
    if (state.currentShift == null) {
        EmptyShiftState { viewModel.setTab(MainTab.SHIFT) }
        return
    }

    var checkoutOpen by rememberSaveable { mutableStateOf(false) }
    var activeCategory by rememberSaveable { mutableStateOf("all") }
    val categories = remember(state.products) {
        listOf("all") + state.products.mapNotNull { it.category?.takeIf(String::isNotBlank) }.distinct()
    }
    val products = remember(state.products, activeCategory) {
        if (activeCategory == "all") state.products else state.products.filter { it.category == activeCategory }
    }
    val cartCount = state.cart.values.sum()
    val total = AppViewModel.cartTotal(state)

    Row(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFFF1F5F9))
            .padding(8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Surface(
            modifier = Modifier
                .weight(1f)
                .fillMaxHeight(),
            color = Color(0xFFF8FAFC),
            shape = RoundedCornerShape(12.dp),
            border = BorderStroke(1.dp, Color(0xFFCBD5E1))
        ) {
            Column(Modifier.fillMaxSize()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(34.dp)
                        .background(Color(0xFFF8FAFC))
                )
                HorizontalDivider(color = Color(0xFFCBD5E1))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(8.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    categories.take(7).forEach { category ->
                        val selected = category == activeCategory
                        Button(
                            onClick = { activeCategory = category },
                            shape = RoundedCornerShape(8.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = if (selected) Color(0xFFF97316) else Color.White,
                                contentColor = if (selected) Color.White else Color(0xFF1E293B)
                            )
                        ) {
                            Text(if (category == "all") "ทั้งหมด" else category, fontWeight = FontWeight.Bold)
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    OutlinedButton(onClick = viewModel::refreshProducts, shape = RoundedCornerShape(8.dp)) {
                        Text("☷ จัดการเมนู", fontWeight = FontWeight.Bold)
                    }
                }
                LazyColumn(
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    items(products.chunked(4)) { rowProducts ->
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            rowProducts.forEach { product ->
                                ProductSaleCard(
                                    product = product,
                                    onAdd = { viewModel.addToCart(product.id) },
                                    modifier = Modifier.weight(1f)
                                )
                            }
                            repeat(4 - rowProducts.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            }
        }

        CartPanel(
            state = state,
            total = total,
            cartCount = cartCount,
            onClear = viewModel::clearCart,
            onDecrease = viewModel::decreaseCart,
            onIncrease = viewModel::addToCart,
            onPay = { checkoutOpen = true }
        )
    }

    if (checkoutOpen) {
        CheckoutDialog(
            total = total,
            onDismiss = { checkoutOpen = false },
            onCash = {
                checkoutOpen = false
                viewModel.checkoutCash(it)
            },
            onTransfer = {
                checkoutOpen = false
                viewModel.checkoutTransfer()
            }
        )
    }
}

@Composable
private fun ProductSaleCard(product: Product, onAdd: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.clickable(onClick = onAdd),
        color = Color.White,
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, Color(0xFFCBD5E1))
    ) {
        Column {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(108.dp)
                    .background(Color(0xFFE2E8F0)),
                contentAlignment = Alignment.Center
            ) {
                Text(product.name.take(1), color = Color(0xFF475569), fontWeight = FontWeight.ExtraBold)
            }
            Column(Modifier.padding(10.dp)) {
                Text(product.name, color = Color(0xFF0F172A), fontWeight = FontWeight.Bold, maxLines = 2)
                Spacer(Modifier.height(8.dp))
                Text("฿${AppViewModel.money(product.price)}", color = Color(0xFFEA580C), fontWeight = FontWeight.ExtraBold)
            }
        }
    }
}

@Composable
private fun CartPanel(
    state: TabletPosUiState,
    total: Double,
    cartCount: Int,
    onClear: () -> Unit,
    onDecrease: (String) -> Unit,
    onIncrease: (String) -> Unit,
    onPay: () -> Unit
) {
    val products = state.products.associateBy { it.id }
    val subtotal = total / 1.07
    val tax = total - subtotal

    Surface(
        modifier = Modifier
            .width(355.dp)
            .fillMaxHeight(),
        color = Color(0xFFF8FAFC),
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, Color(0xFFCBD5E1))
    ) {
        Column(Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("รายการสินค้า ($cartCount)", color = Color(0xFF0F172A), fontWeight = FontWeight.ExtraBold, modifier = Modifier.weight(1f))
                TextButton(onClick = onClear, enabled = cartCount > 0) { Text("ล้างรายการ", color = Color(0xFFEF4444), fontWeight = FontWeight.Bold) }
            }
            HorizontalDivider(color = Color(0xFFCBD5E1))
            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .padding(8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(state.cart.entries.toList(), key = { it.key }) { row ->
                    products[row.key]?.let { product ->
                        CartLineItem(
                            product = product,
                            quantity = row.value,
                            onDecrease = { onDecrease(product.id) },
                            onIncrease = { onIncrease(product.id) }
                        )
                    }
                }
            }
            Surface(
                modifier = Modifier.padding(8.dp),
                color = Color.White,
                shape = RoundedCornerShape(8.dp),
                border = BorderStroke(1.dp, Color(0xFFCBD5E1))
            ) {
                Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(Modifier.fillMaxWidth()) {
                        Text("ส่วนลด", modifier = Modifier.weight(1f), color = Color(0xFF334155))
                        Text("฿ 0.00", color = Color(0xFF334155))
                    }
                    Row(Modifier.fillMaxWidth()) {
                        Text("ภาษี (7%)", modifier = Modifier.weight(1f), color = Color(0xFF334155))
                        Text("฿${AppViewModel.money(tax)}", color = Color(0xFF334155))
                    }
                    HorizontalDivider(color = Color(0xFF94A3B8))
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("ยอดรวม", modifier = Modifier.weight(1f), fontWeight = FontWeight.ExtraBold, color = Color(0xFF0F172A))
                        Text("฿${AppViewModel.money(total)}", fontWeight = FontWeight.ExtraBold, color = Color(0xFFEA580C))
                    }
                }
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(onClick = {}, modifier = Modifier.weight(1f), shape = RoundedCornerShape(8.dp)) { Text("ยกเลิกบิล") }
                OutlinedButton(onClick = {}, modifier = Modifier.weight(1f), shape = RoundedCornerShape(8.dp)) { Text("พักบิล") }
                OutlinedButton(onClick = {}, modifier = Modifier.weight(1f), shape = RoundedCornerShape(8.dp)) { Text("โปรโมชั่น", color = Color(0xFFEA580C)) }
            }
            Button(
                onClick = onPay,
                enabled = cartCount > 0,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp),
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFF97316))
            ) {
                Text("ชำระเงิน", fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.titleLarge)
            }
        }
    }
}

@Composable
private fun CartLineItem(product: Product, quantity: Int, onDecrease: () -> Unit, onIncrease: () -> Unit) {
    Surface(color = Color.White, shape = RoundedCornerShape(8.dp), border = BorderStroke(1.dp, Color(0xFFCBD5E1))) {
        Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .background(Color(0xFFE2E8F0), RoundedCornerShape(22.dp)),
                contentAlignment = Alignment.Center
            ) {
                Text(product.name.take(1), fontWeight = FontWeight.Bold, color = Color(0xFF475569))
            }
            Column(Modifier.weight(1f).padding(horizontal = 8.dp)) {
                Text(product.name, fontWeight = FontWeight.Bold, maxLines = 2)
                Text("฿${AppViewModel.money(product.price)} / ${product.category ?: "-"}", style = MaterialTheme.typography.labelSmall, color = Color(0xFF64748B))
                Row(modifier = Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(onClick = onDecrease, modifier = Modifier.size(28.dp), contentPadding = ButtonDefaults.ContentPadding) { Text("-") }
                    Text(quantity.toString(), modifier = Modifier.padding(horizontal = 10.dp), fontWeight = FontWeight.Bold)
                    OutlinedButton(onClick = onIncrease, modifier = Modifier.size(28.dp), contentPadding = ButtonDefaults.ContentPadding) { Text("+") }
                }
            }
            Text("฿${AppViewModel.money(product.price * quantity)}", color = Color(0xFF0F172A), fontWeight = FontWeight.ExtraBold)
        }
    }
}
@Composable
private fun CheckoutDialog(
    total: Double,
    onDismiss: () -> Unit,
    onCash: (String) -> Unit,
    onTransfer: () -> Unit
) {
    var cash by rememberSaveable(total) { mutableStateOf(AppViewModel.money(total)) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("ชำระเงิน ${AppViewModel.money(total)} บาท") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = cash,
                    onValueChange = { cash = it.filter { char -> char.isDigit() || char == '.' } },
                    label = { Text("รับเงินสด") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Text("ยอดจริงจะถูกตรวจสอบและคำนวณจากเซิร์ฟเวอร์อีกครั้งก่อนบันทึก", style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            Button(onClick = { onCash(cash) }) { Text("เงินสด") }
        },
        dismissButton = {
            Row {
                TextButton(onClick = onTransfer) { Text("โอนเงิน") }
                TextButton(onClick = onDismiss) { Text("ยกเลิก") }
            }
        }
    )
}

@Composable
private fun TablesTab(state: TabletPosUiState, viewModel: AppViewModel) {
    if (state.currentShift == null) {
        EmptyShiftState { viewModel.setTab(MainTab.SHIFT) }
        return
    }
    Column(Modifier.fillMaxSize().background(Color(0xFFF1F5F9)).padding(14.dp)) {
        SectionHeader("Tables", onRefresh = viewModel::refreshTables)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 10.dp)) {
            Button(onClick = {}, shape = RoundedCornerShape(10.dp), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFF97316))) { Text("List", fontWeight = FontWeight.ExtraBold) }
            OutlinedButton(onClick = {}, shape = RoundedCornerShape(10.dp)) { Text("Floor") }
        }
        if (state.tables.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No tables") }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(state.tables.chunked(5)) { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        row.forEach { table ->
                            TableChip(table, state.selectedTableId == table.id, { viewModel.selectTable(table) }, Modifier.weight(1f))
                        }
                        repeat(5 - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun TableChip(table: DiningTable, selected: Boolean, onSelect: () -> Unit, modifier: Modifier = Modifier) {
    val disabled = table.status == "disabled" || table.status == "reserved"
    val color = tableStatusColor(table.status)
    Surface(
        modifier = modifier.height(76.dp).clickable(enabled = !disabled, onClick = onSelect),
        color = if (selected) Color(0xFFFFF7ED) else Color.White,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(2.dp, if (selected) Color(0xFFF97316) else color),
        shadowElevation = 3.dp
    ) {
        Column(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(table.code, fontWeight = FontWeight.ExtraBold, color = Color(0xFF0F172A), maxLines = 1)
            Text(table.name, color = Color(0xFF475569), style = MaterialTheme.typography.labelSmall, maxLines = 1)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(tableStatusText(table.status), color = color, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelSmall, modifier = Modifier.weight(1f))
                if (table.hasQrActivity) Text("QR", color = Color(0xFF0EA5E9), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

@Composable
private fun BuffetTab(state: TabletPosUiState, viewModel: AppViewModel) {
    if (state.currentShift == null) {
        EmptyShiftState { viewModel.setTab(MainTab.SHIFT) }
        return
    }
    var quantityText by rememberSaveable { mutableStateOf("1") }
    val quantity = quantityText.toIntOrNull()?.coerceAtLeast(1) ?: 1
    Column(Modifier.fillMaxSize().background(Color(0xFFF1F5F9)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionHeader("Buffet", onRefresh = viewModel::refreshProducts)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            state.buffetPlans.forEach { plan ->
                Surface(modifier = Modifier.weight(1f), color = Color.White, shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, Color(0xFFCBD5E1))) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(plan.name, fontWeight = FontWeight.ExtraBold, color = Color(0xFF0F172A))
                        Text(plan.mode, color = Color(0xFF64748B), style = MaterialTheme.typography.bodySmall)
                        Text("฿${AppViewModel.money(plan.price)}", color = Color(0xFFF25407), fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.titleLarge)
                        Button(onClick = { viewModel.addBuffet(plan, quantity) }, shape = RoundedCornerShape(8.dp), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFF97316))) { Text("Add x$quantity") }
                    }
                }
            }
        }
        OutlinedCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Quantity", fontWeight = FontWeight.Bold)
                Text(quantityText, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                listOf(listOf("1","2","3"), listOf("4","5","6"), listOf("7","8","9"), listOf("C","0","00")).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        row.forEach { key ->
                            OutlinedButton(onClick = { quantityText = if (key == "C") "" else (quantityText + key).take(3) }, modifier = Modifier.weight(1f), shape = RoundedCornerShape(8.dp)) { Text(key) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ReceiptDialog(receipt: ReceiptSummary, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Receipt ${receipt.orderNo}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                receipt.items.forEach { line ->
                    Row(Modifier.fillMaxWidth()) {
                        Text("${line.quantity} x ${line.name}", modifier = Modifier.weight(1f), maxLines = 1)
                        Text("฿${AppViewModel.money(line.quantity * line.unitPrice)}")
                    }
                }
                HorizontalDivider()
                Text(receipt.paymentMethod, color = Color(0xFF64748B))
                Text("Total ฿${AppViewModel.money(receipt.total)}", fontWeight = FontWeight.ExtraBold, color = Color(0xFFF25407))
                receipt.cashReceived?.let { Text("Cash ฿${AppViewModel.money(it)}") }
                receipt.changeAmount?.let { Text("Change ฿${AppViewModel.money(it)}") }
            }
        },
        confirmButton = { Button(onClick = onDismiss) { Text("Print / Done") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Close") } }
    )
}

@Composable
private fun OrdersTab(state: TabletPosUiState, viewModel: AppViewModel) {
    if (state.currentShift == null) {
        EmptyShiftState { viewModel.setTab(MainTab.SHIFT) }
        return
    }
    Column(Modifier.fillMaxSize().padding(14.dp)) {
        SectionHeader("รายการขาย", onRefresh = viewModel::refreshOrders)
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(state.orders, key = { it.id }) { order ->
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(order.orderNo, fontWeight = FontWeight.SemiBold)
                            Text("${order.orderType} • ${order.status}", style = MaterialTheme.typography.bodySmall, color = Color(0xFF64748B))
                            if (order.createdAt.isNotBlank()) Text(order.createdAt, style = MaterialTheme.typography.labelSmall)
                        }
                        Text("${AppViewModel.money(order.total)} ฿", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

@Composable
private fun ProductsTab(state: TabletPosUiState, viewModel: AppViewModel) {
    if (state.currentShift == null) {
        EmptyShiftState { viewModel.setTab(MainTab.SHIFT) }
        return
    }
    var search by rememberSaveable { mutableStateOf("") }
    val products = if (search.isBlank()) state.products else state.products.filter {
        it.name.contains(search, true) || (it.sku?.contains(search, true) == true) || (it.category?.contains(search, true) == true)
    }
    Column(Modifier.fillMaxSize().padding(14.dp)) {
        SectionHeader("สินค้า", onRefresh = viewModel::refreshProducts)
        OutlinedTextField(
            value = search,
            onValueChange = { search = it },
            label = { Text("ค้นหาสินค้า") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(8.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(products, key = { it.id }) { product ->
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(14.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text(product.name, fontWeight = FontWeight.SemiBold)
                            Text(product.category ?: "ไม่ระบุหมวดหมู่", style = MaterialTheme.typography.bodySmall)
                            product.sku?.let { Text("SKU $it", style = MaterialTheme.typography.labelSmall, color = Color(0xFF64748B)) }
                        }
                        Text("${AppViewModel.money(product.price)} ฿", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

@Composable
private fun MembersTab(state: TabletPosUiState, viewModel: AppViewModel) {
    if (state.currentShift == null) {
        EmptyShiftState { viewModel.setTab(MainTab.SHIFT) }
        return
    }
    var query by rememberSaveable { mutableStateOf(state.memberSearch) }
    var addOpen by rememberSaveable { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().padding(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("สมาชิก", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            TextButton(onClick = { addOpen = true }) { Text("+ เพิ่มสมาชิก") }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text("ค้นหาชื่อ / เบอร์โทร") },
                singleLine = true,
                modifier = Modifier.weight(1f)
            )
            Spacer(Modifier.size(8.dp))
            Button(onClick = { viewModel.refreshMembers(query) }) { Text("ค้นหา") }
        }
        Spacer(Modifier.height(8.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(state.members, key = { it.id }) { member ->
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp)) {
                        Text(member.name, fontWeight = FontWeight.SemiBold)
                        Text(member.phone)
                        if (member.email.isNotBlank()) Text(member.email, style = MaterialTheme.typography.bodySmall)
                        Text("แต้ม ${member.points} • สแตมป์ ${member.stamps}", color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
    }

    if (addOpen) {
        AddMemberDialog(
            onDismiss = { addOpen = false },
            onSave = { name, phone, email ->
                addOpen = false
                viewModel.saveMember(name, phone, email)
            }
        )
    }
}

@Composable
private fun AddMemberDialog(
    onDismiss: () -> Unit,
    onSave: (String, String, String) -> Unit
) {
    var name by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("เพิ่ม / อัปเดตสมาชิก") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text("ชื่อ") }, singleLine = true)
                OutlinedTextField(
                    phone,
                    { phone = it.filter(Char::isDigit).take(10) },
                    label = { Text("เบอร์โทร") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    singleLine = true
                )
                OutlinedTextField(email, { email = it }, label = { Text("อีเมล (ถ้ามี)") }, singleLine = true)
            }
        },
        confirmButton = { Button(onClick = { onSave(name, phone, email) }) { Text("บันทึก") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("ยกเลิก") } }
    )
}

@Composable
private fun ShiftTab(state: TabletPosUiState, viewModel: AppViewModel) {
    var amount by rememberSaveable(state.currentShift?.id) { mutableStateOf("") }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text("ปิดยอด / กะ", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        OutlinedCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (state.currentShift == null) {
                    Text("ยังไม่มีกะที่เปิดอยู่", fontWeight = FontWeight.SemiBold)
                    Text("เปิดกะก่อนเริ่มขาย ระบบหลักจะผูกกะกับ POS session และเครื่องที่เลือก")
                } else {
                    Text("กะกำลังเปิด", color = Color(0xFF047857), fontWeight = FontWeight.Bold)
                    Text("Shift ID: ${state.currentShift.id}")
                    Text("เปิดเมื่อ: ${state.currentShift.openedAt}")
                    state.currentShift.deviceCode?.let { Text("เครื่อง: $it") }
                    state.currentShift.openingCash?.let { Text("เงินสดตั้งต้น: ${AppViewModel.money(it)} บาท") }
                }
            }
        }

        if (state.currentShift == null && state.availableOpenShifts.isNotEmpty()) {
            OutlinedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("กะที่เปิดอยู่", fontWeight = FontWeight.SemiBold)
                    state.availableOpenShifts.forEach { shift ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(shift.id, style = MaterialTheme.typography.bodySmall)
                                Text(shift.openedAt, color = Color(0xFF64748B), style = MaterialTheme.typography.bodySmall)
                            }
                            OutlinedButton(onClick = { viewModel.joinShift(shift.id) }) { Text("เข้ากะ") }
                        }
                    }
                }
            }
        }
        OutlinedTextField(
            value = amount,
            onValueChange = { amount = it.filter { char -> char.isDigit() || char == '.' } },
            label = { Text(if (state.currentShift == null) "เงินสดตั้งต้น (ไม่บังคับ)" else "เงินสดปิดกะ (ไม่บังคับ)") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )

        if (state.currentShift == null) {
            Button(onClick = { viewModel.openShift(amount) }, modifier = Modifier.fillMaxWidth()) {
                Text("เปิดกะ")
            }
        } else {
            Button(onClick = { viewModel.closeShift(amount) }, modifier = Modifier.fillMaxWidth()) {
                Text("ปิดกะ")
            }
        }

        OutlinedButton(onClick = viewModel::refreshShift, modifier = Modifier.fillMaxWidth()) {
            Text("ตรวจสอบสถานะกะอีกครั้ง")
        }

        Text(
            "การเปิด/ปิดกะใช้ API และ validation ของ CpiPOS Server เดียวกับ POS หลัก ไม่บันทึกข้อมูลธุรกิจโดยตรงจากแอป",
            style = MaterialTheme.typography.bodySmall,
            color = Color(0xFF64748B)
        )
    }
}

@Composable
private fun SettingsTab(state: TabletPosUiState, viewModel: AppViewModel) {
    var printerHost by rememberSaveable { mutableStateOf("") }
    var printerPort by rememberSaveable { mutableStateOf("9100") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("ตั้งค่า", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        InfoCard("แอป", "CpIPOS Tablet POS ${BuildConfig.VERSION_NAME}")
        InfoCard("Runtime", "Native Android 100% - Kotlin + Jetpack Compose")
        InfoCard("Server", BuildConfig.CPIPOS_API_BASE_URL)
        InfoCard("บัญชี", state.employee?.let { "${it.name} (${it.role})" } ?: "-")
        InfoCard("ร้าน", state.tenantName.ifBlank { "-" })

        OutlinedCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Printer diagnostics", fontWeight = FontWeight.SemiBold)
                OutlinedTextField(
                    value = printerHost,
                    onValueChange = { printerHost = it.trim() },
                    label = { Text("Printer IP/address") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = printerPort,
                    onValueChange = { printerPort = it.filter(Char::isDigit).take(5) },
                    label = { Text("Port") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { viewModel.savePrinter(printerHost, printerPort) }) { Text("บันทึก") }
                    OutlinedButton(onClick = viewModel::testPrinter) { Text("ทดสอบ TCP") }
                }
            }
        }

        OutlinedButton(
            onClick = viewModel::logout,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("ออกจากระบบ")
        }
    }
}

@Composable
private fun InfoCard(label: String, value: String) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(label, modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
            Text(value, color = Color(0xFF64748B))
        }
    }
}
@Composable
private fun EmptyShiftState(onOpenShift: () -> Unit) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        OutlinedCard {
            Column(
                modifier = Modifier.padding(22.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text("กรุณาเปิดกะก่อนใช้งาน", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("CpiPOS Mobile ใช้ Session + Shift gate ของระบบหลัก")
                Button(onClick = onOpenShift) { Text("ไปหน้าปิดยอด / กะ") }
            }
        }
    }
}

@Composable
private fun SectionHeader(title: String, onRefresh: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        TextButton(onClick = onRefresh) { Text("รีเฟรช") }
    }
}

private val MainTab.thaiLabel: String
    get() = when (this) {
        MainTab.SALES -> "ขาย"
        MainTab.TABLES -> "Tables"
        MainTab.BUFFET -> "Buffet"
        MainTab.ORDERS -> "รายการ"
        MainTab.PRODUCTS -> "สินค้า"
        MainTab.MEMBERS -> "สมาชิก"
        MainTab.SHIFT -> "ปิดยอด"
        MainTab.SETTINGS -> "ตั้งค่า"
    }

private val MainTab.shortLabel: String
    get() = when (this) {
        MainTab.SALES -> "฿"
        MainTab.TABLES -> "T"
        MainTab.BUFFET -> "B"
        MainTab.ORDERS -> "≡"
        MainTab.PRODUCTS -> "□"
        MainTab.MEMBERS -> "☺"
        MainTab.SHIFT -> "✓"
        MainTab.SETTINGS -> "⚙"
    }

private fun Product.stockBadge(): String? = when {
    isOutOfStock -> "Out of stock"
    stockOnHandUnits != null -> "Stock ${AppViewModel.money(stockOnHandUnits)}"
    else -> null
}

private fun tableStatusColor(status: String): Color = when (status) {
    "occupied" -> Color(0xFFF97316)
    "reserved" -> Color(0xFF7C3AED)
    "disabled" -> Color(0xFF94A3B8)
    else -> Color(0xFF047857)
}

private fun tableStatusText(status: String): String = when (status) {
    "occupied" -> "Open bill"
    "reserved" -> "Reserved"
    "disabled" -> "Locked"
    else -> "Available"
}