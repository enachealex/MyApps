package com.family.kidview.parent

import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.foundation.Image
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Server address from the parent-app QR code: kidview://parent?server=192.168.1.20:8765 */
fun parseParentLink(text: String?): String? {
    val uri = runCatching { Uri.parse(text?.trim() ?: return null) }.getOrNull() ?: return null
    val server = when {
        // The dashboard's QR code: its own address, e.g. http://192.168.1.20:8765/admin
        (uri.scheme == "http" || uri.scheme == "https") && uri.path.orEmpty().startsWith("/admin") ->
            if (uri.scheme == "https") "https://${uri.authority}" else uri.authority
        // Older codes: kidview://parent?server=...
        uri.scheme == "kidview" && uri.host == "parent" -> uri.getQueryParameter("server")
        else -> null
    }
    return server?.takeIf { it.isNotBlank() }
}

class ParentActivity : ComponentActivity() {
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (Updater.onInstallResult(this, intent)) return
        parseParentLink(intent.data?.toString())?.let { linkedServer.value = it }
    }

    companion object {
        val linkedServer = mutableStateOf<String?>(null)
    }

    override fun onResume() {
        super.onResume()
        Updater.onResume(this)   // back from allowing installs: carry on with the update
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        Updater.onInstallResult(this, intent)   // reopened after installing an update
        parseParentLink(intent?.data?.toString())?.let { linkedServer.value = it }
        setContent {
            MaterialTheme(
                colorScheme = lightColorScheme(
                    primary = Purple, onPrimary = Color.White,
                    secondaryContainer = Color(0xFFE8E2FF), onSecondaryContainer = PurpleDark,
                    background = Color(0xFFF6F5FA), surface = Color(0xFFF6F5FA),
                    surfaceContainer = Color.White, surfaceContainerLow = Color.White,
                ),
            ) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) { ParentApp() }
            }
        }
    }
}

@Composable
fun ParentApp(vm: ParentViewModel = viewModel()) {
    if (vm.api == null) SignIn(vm) else Main(vm)
    // Silent check; it only shows something when there's a new version (or after "Check for updates").
    UpdatePrompt(vm.updateCheck) { vm.appUpToDate() }
}

/** Server address from a kid's setup code (kidview://pair?server=...), if that's what was scanned. */
fun parsePairServer(text: String?): String? {
    val uri = runCatching { Uri.parse(text?.trim() ?: return null) }.getOrNull() ?: return null
    return if (uri.scheme == "kidview" && uri.host == "pair") uri.getQueryParameter("server") else null
}

/** A QR code drawn on the phone, e.g. so a kid's tablet can scan it to set itself up. */
@Composable
fun QrImage(text: String, sizeDp: Int) {
    val bitmap = remember(text) {
        val n = 480
        val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, n, n)
        val px = IntArray(n * n) { i -> if (m[i % n, i / n]) 0xFF1D2330.toInt() else 0xFFFFFFFF.toInt() }
        Bitmap.createBitmap(px, n, n, Bitmap.Config.ARGB_8888).asImageBitmap()
    }
    Image(bitmap, contentDescription = "Setup code", modifier = Modifier.size(sizeDp.dp).clip(RoundedCornerShape(12.dp)))
}

// ------------------------------------------------------------------ sign in

@Composable
fun SignIn(vm: ParentViewModel) {
    var server by rememberSaveable { mutableStateOf(vm.savedServer) }
    var name by rememberSaveable { mutableStateOf(vm.savedName) }
    var pin by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val scanner = rememberLauncherForActivityResult(ScanContract()) { r ->
        val s = parseParentLink(r.contents) ?: parsePairServer(r.contents)
        if (s != null) { server = s; error = null } else if (r.contents != null) error = "That isn't a KidView code."
    }
    val linked by ParentActivity.linkedServer
    LaunchedEffect(linked) { linked?.let { server = it; ParentActivity.linkedServer.value = null } }

    Column(
        Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Spacer(Modifier.height(24.dp))
        Box(Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)).background(PurpleDark), contentAlignment = Alignment.Center) {
            Text("▶", color = Color.White, fontSize = 22.sp)
        }
        Text("KidView Parent", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold, color = PurpleDark)
        Text("Scan the code on the KidView dashboard (Home → Parent accounts), then sign in with your name and PIN.",
            color = Muted)
        OutlinedButton(
            onClick = {
                scanner.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                    .setPrompt("Point the camera at the code on the KidView dashboard").setBeepEnabled(false).setOrientationLocked(false))
            },
            modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp),
        ) { Text("Scan code") }
        OutlinedTextField(server, { server = it }, label = { Text("Server address") }, placeholder = { Text("192.168.1.20:8765") },
            singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
        OutlinedTextField(name, { name = it }, label = { Text("Your name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(pin, { pin = it.filter(Char::isDigit).take(8) }, label = { Text("PIN") }, singleLine = true,
            modifier = Modifier.fillMaxWidth(), visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
        error?.let { Text(it, color = Bad) }
        Button(
            onClick = { busy = true; error = null; scope.launch { error = vm.signIn(server, name, pin); busy = false } },
            enabled = !busy && server.isNotBlank() && name.isNotBlank() && pin.length >= 4,
            modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(14.dp),
        ) { Text(if (busy) "Signing in…" else "Sign in", fontSize = 16.sp) }
    }
}

// ------------------------------------------------------------------ main screen

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Main(vm: ParentViewModel) {
    val snackHost = remember { SnackbarHostState() }
    var showAccount by remember { mutableStateOf(false) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    // Keep everything fresh while the app is open.
    LaunchedEffect(Unit) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                vm.refresh()
                delay(15_000)
            }
        }
    }
    LaunchedEffect(vm.tab) {
        if (vm.tab == Tab.Activity) vm.loadActivity()
        if (vm.tab == Tab.Kids) { if (vm.kidSel == null) vm.loadLibrary() else vm.loadKid() }
    }
    LaunchedEffect(vm.snack) { vm.snack?.let { snackHost.showSnackbar(it); vm.snack = null } }

    if (vm.showSettings) {
        BackHandler { vm.showSettings = false }
        SettingsScreen(vm, snackHost)
        return
    }

    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text(vm.tab.title, fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    // Top-left: who's signed in
                    Box(Modifier.padding(start = 12.dp).size(38.dp).clip(CircleShape).background(Purple)
                        .clickable { showAccount = true }, contentAlignment = Alignment.Center) {
                        Text(vm.name.take(1).uppercase(), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                    }
                },
                actions = {
                    // Top-right: settings
                    IconButton(onClick = { vm.showSettings = true }) { Icon(painterResource(R.drawable.ic_settings), "Settings") }
                },
            )
        },
        bottomBar = {
            NavigationBar(containerColor = Color.White) {
                Tab.entries.forEach { t ->
                    NavigationBarItem(
                        selected = vm.tab == t, onClick = { vm.tab = t },
                        icon = { Icon(painterResource(t.icon), null) }, label = { Text(t.title, fontSize = 11.sp) },
                    )
                }
            }
        },
        snackbarHost = { SnackbarHost(snackHost) },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            vm.offline?.let {
                Text(it, color = Warn, fontSize = 13.sp,
                    modifier = Modifier.fillMaxWidth().background(WarnSoft).padding(horizontal = 16.dp, vertical = 8.dp))
            }
            if (vm.state == null) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            } else when (vm.tab) {
                Tab.Watching -> WatchingTab(vm)
                Tab.Search -> SearchTab(vm)
                Tab.Activity -> ActivityTab(vm)
                Tab.Kids -> KidsTab(vm)
                Tab.Rules -> RulesTab(vm)
            }
        }
    }

    if (showAccount) AccountSheet(vm) { showAccount = false }
}

// ------------------------------------------------------------------ account (top-left)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountSheet(vm: ParentViewModel, onClose: () -> Unit) {
    var changingPin by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onClose, containerColor = Color.White) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Box(Modifier.size(56.dp).clip(CircleShape).background(Purple), contentAlignment = Alignment.Center) {
                    Text(vm.name.take(1).uppercase(), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 24.sp)
                }
                Column {
                    Text(vm.name, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    Text("Signed in on ${vm.device}", color = Muted, fontSize = 13.sp)
                    Text("Server ${vm.server}", color = Muted, fontSize = 13.sp)
                }
            }
            Text("Changes you make are shown in Activity with your name.", color = Muted, fontSize = 13.sp)
            OutlinedButton(onClick = { changingPin = true }, modifier = Modifier.fillMaxWidth()) { Text("Change PIN") }
            Button(onClick = { onClose(); vm.signOut() }, modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Bad)) { Text("Sign out") }
        }
    }
    if (changingPin) ChangePinDialog(vm) { changingPin = false }
}

@Composable
fun ChangePinDialog(vm: ParentViewModel, onClose: () -> Unit) {
    var old by remember { mutableStateOf("") }
    var new by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Change PIN") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                for ((label, value, set) in listOf(Triple("Current PIN", old, { s: String -> old = s }), Triple("New PIN (4-8 digits)", new, { s: String -> new = s }))) {
                    OutlinedTextField(value, { set(it.filter(Char::isDigit).take(8)) }, label = { Text(label) }, singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
                }
                error?.let { Text(it, color = Bad) }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                scope.launch {
                    error = vm.changePin(old, new)
                    if (error == null) { vm.snack = "PIN changed"; onClose() }
                }
            }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } },
    )
}

// ------------------------------------------------------------------ settings (top-right)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(vm: ParentViewModel, snackHost: SnackbarHostState) {
    val r = vm.rules
    val st = vm.state ?: return
    var confirmDevice by remember { mutableStateOf<Pair<String, String>?>(null) }
    var confirmParent by remember { mutableStateOf<Pair<String, String>?>(null) }
    var confirmCode by remember { mutableStateOf(false) }
    var renamingDevice by remember { mutableStateOf<Pair<String, String>?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings", fontWeight = FontWeight.Bold) },
                navigationIcon = { IconButton(onClick = { vm.showSettings = false }) { Icon(painterResource(R.drawable.ic_back), "Back") } },
            )
        },
        snackbarHost = { SnackbarHost(snackHost) },
    ) { padding ->
        Box(Modifier.padding(padding)) { TabPage {
            item {
                Section("Kids' app") {
                    SwitchRow("Allow searching", "Off = kids only see your Picks", r.optBoolean("search_enabled", true)) {
                        vm.setRule("search_enabled", it)
                    }
                    SwitchRow("Hide Shorts", "Short vertical videos", r.optBoolean("block_shorts", true)) { vm.setRule("block_shorts", it) }
                    SwitchRow("Check descriptions and tags", "Stricter: also looks for blocked words there",
                        r.optBoolean("check_descriptions", true)) { vm.setRule("check_descriptions", it) }
                    ChoiceRow("Longest video", r.optInt("max_minutes"),
                        listOf(0 to "No limit", 10 to "10 min", 15 to "15 min", 20 to "20 min", 30 to "30 min", 45 to "45 min", 60 to "1 hour", 120 to "2 hours")) {
                        vm.setRule("max_minutes", it)
                    }
                    ChoiceRow("Video quality", r.optInt("max_quality", 720),
                        listOf(360 to "360p", 480 to "480p", 720 to "720p", 1080 to "1080p")) { vm.setRule("max_quality", it) }
                }
            }
            item {
                val ctx = androidx.compose.ui.platform.LocalContext.current
                val serverUpdate = st.optJSONObject("update")
                val updating = st.optJSONObject("updating")
                Section("Updates") {
                    Text("KidView Parent ${Updater.currentVersion(ctx)} · Server ${st.str("version")}", color = Muted, fontSize = 13.sp)
                    if (updating?.str("version")?.isNotBlank() == true) {
                        Text("Updating the server to ${updating.str("version")}…", fontWeight = FontWeight.Medium)
                    } else if (serverUpdate != null) {
                        Text("Server ${serverUpdate.str("version")} is ready.", fontWeight = FontWeight.Medium)
                        updating?.str("error")?.takeIf { it.isNotBlank() }?.let {
                            Text("The last try didn't work: $it", color = Color(0xFFC43D3D), fontSize = 13.sp)
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            if (serverUpdate.optBoolean("auto")) Button(onClick = { vm.updateServer() }) { Text("Update server") }
                            TextButton(onClick = { openLink(ctx, serverUpdate.str("url")) }) { Text("What's new") }
                        }
                        if (!serverUpdate.optBoolean("auto")) {
                            serverUpdate.str("how").takeIf { it.isNotBlank() }?.let { Text(it, color = Muted, fontSize = 13.sp) }
                        }
                    }
                    OutlinedButton(onClick = { vm.checkForUpdates() }) { Text("Check for updates") }
                }
            }
            item {
                Section("Activity", "Older activity is deleted automatically.") {
                    ChoiceRow("Keep activity for", r.optInt("activity_days", 7),
                        listOf(7 to "7 days", 14 to "14 days", 30 to "30 days", 90 to "90 days")) { vm.setRule("activity_days", it) }
                }
            }
            item {
                Section("Set up a kid's device", "Scan this with the child's phone or tablet camera: it downloads KidView and connects it. Already have KidView? Tap Scan code in the app.") {
                    val addresses = st.optJSONArray("addresses")?.objects().orEmpty()
                    var pick by remember { mutableStateOf(0) }
                    addresses.getOrNull(pick)?.let { a ->
                        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { QrImage(vm.kidPairLink(a.str("addr")), 200) }
                    }
                    addresses.forEachIndexed { i, it ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.clickable { pick = i }) {
                            RadioButton(selected = pick == i, onClick = { pick = i })
                            Text(it.str("addr"), fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                            Text(it.str("label"), color = Muted, fontSize = 12.sp)
                        }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Family code", color = Muted, fontSize = 12.sp)
                            Text(st.str("family_code"), fontSize = 30.sp, fontWeight = FontWeight.Bold, letterSpacing = 5.sp)
                        }
                        OutlinedButton(onClick = { confirmCode = true }) { Text("New code") }
                    }
                }
            }
            item {
                Section("Kids' devices", "Removing a device signs it out.") {
                    val devices = st.optJSONArray("devices")?.objects().orEmpty()
                    if (devices.isEmpty()) Empty("No devices yet")
                    devices.forEach { d ->
                        ItemRow(d.str("name"), "Last used " + agoText(d.optDouble("last_seen")),
                            onEdit = { renamingDevice = d.str("id") to d.str("name") }) {
                            confirmDevice = d.str("id") to d.str("name")
                        }
                    }
                }
            }
            item {
                Section("Parent accounts", "Each parent signs in with their own name and PIN.") {
                    st.optJSONArray("parents")?.objects()?.forEach { p ->
                        ItemRow(p.str("name") + if (p.str("name").equals(vm.name, true)) " (you)" else "", "Added " + agoText(p.optDouble("created"))) {
                            confirmParent = p.str("id") to p.str("name")
                        }
                    }
                    AddParentRow { name, pin -> vm.addParent(name, pin) }
                }
            }
        } }
    }

    Confirm(confirmDevice?.let { "Remove ${it.second}? It will need the family code to get back in." }, "Remove",
        { confirmDevice = null }) { confirmDevice?.let { vm.removeDevice(it.first) } }
    Confirm(confirmParent?.let { "Remove ${it.second}'s parent account? Their phone will be signed out." }, "Remove",
        { confirmParent = null }) {
        confirmParent?.let { vm.removeParent(it.first); if (it.second.equals(vm.name, true)) vm.signOut() }
    }
    Confirm(if (confirmCode) "Make a new family code? Devices already set up keep working." else null, "Make new code",
        { confirmCode = false }) { vm.newFamilyCode() }
    renamingDevice?.let { (token, oldName) ->
        RenameDialog(oldName, onDismiss = { renamingDevice = null }) { vm.renameDevice(token, it); renamingDevice = null }
    }
}

@Composable
fun RenameDialog(current: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var name by remember { mutableStateOf(current) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Rename device") },
        text = {
            OutlinedTextField(name, { name = it.take(40) }, label = { Text("Device name") }, singleLine = true,
                modifier = Modifier.fillMaxWidth())
        },
        confirmButton = { TextButton(onClick = { onSave(name.trim()) }, enabled = name.isNotBlank()) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
fun SwitchRow(title: String, subtitle: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.Medium)
            if (subtitle != null) Text(subtitle, color = Muted, fontSize = 12.sp)
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
fun ChoiceRow(title: String, value: Int, options: List<Pair<Int, String>>, onPick: (Int) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(title, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
        Box {
            OutlinedButton(onClick = { open = true }) { Text(options.firstOrNull { it.first == value }?.second ?: "$value") }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                options.forEach { (v, label) -> DropdownMenuItem(text = { Text(label) }, onClick = { open = false; onPick(v) }) }
            }
        }
    }
}

@Composable
fun AddParentRow(onAdd: (String, String) -> Unit) {
    var name by remember { mutableStateOf("") }
    var pin by remember { mutableStateOf("") }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(name, { name = it.take(30) }, placeholder = { Text("Name") }, singleLine = true, modifier = Modifier.weight(1f))
        OutlinedTextField(pin, { pin = it.filter(Char::isDigit).take(8) }, placeholder = { Text("PIN") }, singleLine = true,
            modifier = Modifier.width(96.dp), visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
        // Disabled until there's a name and a 4-8 digit PIN.
        Button(onClick = { onAdd(name.trim(), pin); name = ""; pin = "" }, enabled = name.isNotBlank() && pin.length in 4..8) { Text("Add") }
    }
}
