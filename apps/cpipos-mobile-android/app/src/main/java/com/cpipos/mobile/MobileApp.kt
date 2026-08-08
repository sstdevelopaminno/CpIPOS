package com.cpipos.mobile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
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
fun CpiposMobileApp(viewModel: AppViewModel) {
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
            Text("CpIPOS Mobile", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
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
            Text("CpIPOS Mobile", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
            Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Text(subtitle, color = Color(0xFF64748B))
            Spacer(Modifier.height(4.dp))
            content()
            Spacer(Modifier.height(8.dp))
            Text(
                "Native Android • ไม่ใช้ WebView",
                style = MaterialTheme.typography.labelMedium,
                color = Color(0xFF64748B)
            )
        }
    }
}

@Composable
private fun StoreLoginScreen(state: MobileUiState, viewModel: AppViewModel) {
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
private fun BranchScreen(state: MobileUiState, viewModel: AppViewModel) {
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
private fun EmployeeScreen(state: MobileUiState, viewModel: AppViewModel) {
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
private fun DeviceScreen(state: MobileUiState, viewModel: AppViewModel) {
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
    state: MobileUiState,
    viewModel: AppViewModel,
    snackbar: SnackbarHostState
) {
    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("CpIPOS Mobile", fontWeight = FontWeight.Bold)
                        Text(
                            buildString {
                                if (state.tenantName.isNotBlank()) append(state.tenantName)
                                state.employee?.name?.let {
                                    if (isNotEmpty()) append(" • ")
                                    append(it)
                                }
                            },
                            style = MaterialTheme.typography.labelMedium,
                            color = Color(0xFF64748B)
                        )
                    }
                },
                actions = {
                    val shiftText = if (state.currentShift == null) "ยังไม่เปิดกะ" else "กะเปิด"
                    Text(
                        shiftText,
                        modifier = Modifier.padding(end = 14.dp),
                        color = if (state.currentShift == null) Color(0xFFB45309) else Color(0xFF047857),
                        fontWeight = FontWeight.SemiBold
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.White)
            )
        },
        bottomBar = {
            NavigationBar {
                MainTab.entries.forEach { tab ->
                    NavigationBarItem(
                        selected = state.activeTab == tab,
                        onClick = { viewModel.setTab(tab) },
                        icon = { Text(tab.shortLabel) },
                        label = { Text(tab.thaiLabel, maxLines = 1) }
                    )
                }
            }
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .padding(innerPadding)
                .fillMaxSize()
        ) {
            when (state.activeTab) {
                MainTab.SALES -> SalesTab(state, viewModel)
                MainTab.ORDERS -> OrdersTab(state, viewModel)
                MainTab.PRODUCTS -> ProductsTab(state, viewModel)
                MainTab.MEMBERS -> MembersTab(state, viewModel)
                MainTab.SHIFT -> ShiftTab(state, viewModel)
                MainTab.SETTINGS -> SettingsTab(state, viewModel)
            }
        }
    }
}

@Composable
private fun SalesTab(state: MobileUiState, viewModel: AppViewModel) {
    if (state.currentShift == null) {
        EmptyShiftState { viewModel.setTab(MainTab.SHIFT) }
        return
    }

    var search by rememberSaveable { mutableStateOf("") }
    var checkoutOpen by rememberSaveable { mutableStateOf(false) }
    val products = remember(state.products, search) {
        if (search.isBlank()) state.products else state.products.filter {
            it.name.contains(search, ignoreCase = true) ||
                (it.sku?.contains(search, ignoreCase = true) == true) ||
                (it.category?.contains(search, ignoreCase = true) == true)
        }
    }
    val cartCount = state.cart.values.sum()
    val total = AppViewModel.cartTotal(state)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(14.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("ขาย", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            TextButton(onClick = viewModel::refreshProducts) { Text("รีเฟรช") }
        }
        OutlinedTextField(
            value = search,
            onValueChange = { search = it },
            label = { Text("ค้นหาสินค้า / SKU / หมวดหมู่") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(10.dp))
        LazyColumn(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(products, key = { it.id }) { product ->
                ProductSaleRow(
                    product = product,
                    quantity = state.cart[product.id] ?: 0,
                    onAdd = { viewModel.addToCart(product.id) },
                    onDecrease = { viewModel.decreaseCart(product.id) }
                )
            }
        }
        HorizontalDivider()
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text("$cartCount รายการ", color = Color(0xFF64748B))
                Text("${AppViewModel.money(total)} บาท", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
            TextButton(onClick = viewModel::clearCart, enabled = cartCount > 0) { Text("ล้าง") }
            Button(onClick = { checkoutOpen = true }, enabled = cartCount > 0) { Text("ชำระเงิน") }
        }
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
private fun ProductSaleRow(
    product: Product,
    quantity: Int,
    onAdd: () -> Unit,
    onDecrease: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text(product.name, fontWeight = FontWeight.SemiBold)
                Text(
                    listOfNotNull(product.category, product.sku).joinToString(" • ").ifBlank { "สินค้า" },
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFF64748B)
                )
                Text("${AppViewModel.money(product.price)} บาท", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
            }
            if (quantity > 0) {
                OutlinedButton(onClick = onDecrease, modifier = Modifier.size(44.dp)) { Text("−") }
                Text(
                    quantity.toString(),
                    modifier = Modifier.padding(horizontal = 12.dp),
                    fontWeight = FontWeight.Bold
                )
            }
            Button(onClick = onAdd, modifier = Modifier.size(44.dp), contentPadding = ButtonDefaults.ContentPadding) {
                Text("+")
            }
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
private fun OrdersTab(state: MobileUiState, viewModel: AppViewModel) {
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
private fun ProductsTab(state: MobileUiState, viewModel: AppViewModel) {
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
private fun MembersTab(state: MobileUiState, viewModel: AppViewModel) {
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
private fun ShiftTab(state: MobileUiState, viewModel: AppViewModel) {
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
private fun SettingsTab(state: MobileUiState, viewModel: AppViewModel) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("ตั้งค่า", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        InfoCard("แอป", "CpIPOS Mobile ${BuildConfig.VERSION_NAME}")
        InfoCard("Runtime", "Native Android 100% • Kotlin + Jetpack Compose • ไม่มี WebView")
        InfoCard("Server", BuildConfig.CPIPOS_API_BASE_URL)
        InfoCard("บัญชี", state.employee?.let { "${it.name} (${it.role})" } ?: "-")
        InfoCard("ร้าน", state.tenantName.ifBlank { "-" })
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
        Column(Modifier.padding(14.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = Color(0xFF64748B))
            Text(value, fontWeight = FontWeight.SemiBold)
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
        MainTab.ORDERS -> "รายการ"
        MainTab.PRODUCTS -> "สินค้า"
        MainTab.MEMBERS -> "สมาชิก"
        MainTab.SHIFT -> "ปิดยอด"
        MainTab.SETTINGS -> "ตั้งค่า"
    }

private val MainTab.shortLabel: String
    get() = when (this) {
        MainTab.SALES -> "฿"
        MainTab.ORDERS -> "≡"
        MainTab.PRODUCTS -> "□"
        MainTab.MEMBERS -> "☺"
        MainTab.SHIFT -> "✓"
        MainTab.SETTINGS -> "⚙"
    }
