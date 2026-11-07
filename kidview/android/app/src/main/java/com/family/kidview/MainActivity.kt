package com.family.kidview

import android.app.Application
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.speech.RecognizerIntent
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.work.WorkManager
import coil3.compose.AsyncImage
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

internal val Purple = Color(0xFF6C4BF4)
internal val PurpleDark = Color(0xFF3B2A8C)
internal val Lavender = Color(0xFFF7F2FF)
internal val Sunny = Color(0xFFFFC93C)

/** What the setup QR code holds: kidview://pair?server=192.168.1.20:8765&code=123456 */
data class PairInfo(val server: String, val code: String)

fun parsePairLink(text: String?): PairInfo? {
    val uri = runCatching { Uri.parse(text?.trim() ?: return null) }.getOrNull() ?: return null
    return when {
        // The dashboard's kid code: the server's setup page, e.g. http://192.168.1.20:8765/add?code=123456
        (uri.scheme == "http" || uri.scheme == "https") && uri.path == "/add" -> {
            val host = uri.authority?.takeIf { it.isNotBlank() } ?: return null
            PairInfo(if (uri.scheme == "https") "https://$host" else host, uri.getQueryParameter("code").orEmpty())
        }
        // What that page's Open KidView button (and older codes) use: kidview://pair?server=...&code=...
        uri.scheme == "kidview" && uri.host == "pair" -> {
            val server = uri.getQueryParameter("server")?.takeIf { it.isNotBlank() } ?: return null
            PairInfo(server, uri.getQueryParameter("code").orEmpty())
        }
        else -> null
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (Api.from(this) != null) Library.schedule(this)
        Updater.onInstallResult(this, intent)   // reopened after installing an update
        handlePairLink(intent)
        setContent {
            MaterialTheme(colorScheme = lightColorScheme(primary = Purple, background = Lavender, surface = Color.White)) {
                Surface(Modifier.fillMaxSize(), color = Lavender) { App() }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (Updater.onInstallResult(this, intent)) return
        handlePairLink(intent)
    }

    /** Opened from the setup QR code with the phone's camera: go to setup with the details filled in. */
    private fun handlePairLink(intent: Intent?) {
        parsePairLink(intent?.data?.toString())?.let { pendingPair.value = it }
    }

    override fun onResume() {
        super.onResume()
        Updater.onResume(this)   // back from allowing installs: carry on with the update
        // Coming back from a video: re-check whether watching is still allowed.
        resumeTick.intValue++
    }

    companion object {
        val resumeTick = mutableIntStateOf(0)
        val pendingPair = mutableStateOf<PairInfo?>(null)
    }
}

// ------------------------------------------------------------------ state

class KidViewModel(app: Application) : AndroidViewModel(app) {
    private val prefs = Prefs(app)
    var api by mutableStateOf(Api.from(app))
        private set
    var showSetup by mutableStateOf(api == null)
    /** Grown-up setup → Check for updates: bump to check now; the note says it's up to date. */
    var updateCheck by mutableIntStateOf(0)
    var updateNote by mutableStateOf<String?>(null)
    var home by mutableStateOf<Home?>(null)
    var results by mutableStateOf<List<Video>?>(null)
    var searchedFor by mutableStateOf("")
    var loading by mutableStateOf(false)
    var message by mutableStateOf<String?>(null)
    /** Videos kept on this device for watching without internet (the Offline tab). */
    var onDevice by mutableStateOf(Library.saved(app))
    var tab by mutableStateOf(Tab.Home)
    /** The Saved tab: videos saved with the heart, and History. Null until loaded. */
    var savedVideos by mutableStateOf<List<Video>?>(null)
    var history by mutableStateOf<List<Watched>?>(null)
    var showHistory by mutableStateOf(false)
    private var savedJob: Job? = null
    var recommended by mutableStateOf<List<Pair<String, List<Video>>>>(emptyList())
    var offline by mutableStateOf(false)
    private var job: Job? = null

    init {
        // When a background sync finishes, show the newly saved videos.
        val wm = WorkManager.getInstance(app)
        for (name in listOf(Library.SYNC_NOW, Library.SYNC_PERIODIC)) {
            viewModelScope.launch {
                wm.getWorkInfosForUniqueWorkFlow(name).collect { onDevice = Library.saved(app) }
            }
        }
    }

    fun refreshHome() {
        val a = api ?: return
        val ctx = getApplication<Application>()
        onDevice = Library.saved(ctx)
        if (tab == Tab.Saved) refreshSaved()
        viewModelScope.launch {
            try {
                home = a.home()
                offline = false
                Watching.save(ctx, home!!.raw)
                rulesRev = home!!.raw.optString("rules_rev")
                if (home?.paused == true) results = null
                if (results == null) message = null
                // Drop anything that was removed or blocked, then fetch new videos in the background.
                runCatching { Library.refresh(ctx, a) }
                onDevice = Library.saved(ctx)
                Library.syncSoon(ctx)
                // Recommended videos: a funny + educational mix at first, then based on what they watch.
                runCatching { a.recommended() }.onSuccess { recommended = it }
            } catch (e: ApiException) {
                if (e.code == 401) {
                    showSetup = true
                } else {
                    offline = true
                    home = Home(paused = Watching.pausedNow(ctx), searchEnabled = false, picks = emptyList(),
                        backAt = Watching.backAt(ctx))
                    message = e.message
                }
            }
        }
    }

    /** Called every 30 seconds so schedules take effect while the app is open (online or not). */
    fun recheck() {
        val a = api ?: return
        val ctx = getApplication<Application>()
        viewModelScope.launch {
            try {
                val h = a.home()
                Watching.save(ctx, h.raw)
                if (offline) { offline = false; refreshHome(); return@launch }
                if (h.paused) results = null
                home = h
                // A grown-up changed the rules: refresh what's on screen so blocked videos disappear.
                val rev = h.raw.optString("rules_rev")
                if (rulesRev != null && rev != rulesRev && !h.paused) {
                    if (results != null && searchedFor.isNotEmpty()) search(searchedFor, quiet = true)
                    if (savedVideos != null || history != null) refreshSaved()
                    runCatching { a.recommended() }.onSuccess { recommended = it }
                    Library.syncSoon(ctx)
                }
                rulesRev = rev
            } catch (e: ApiException) {
                if (e.code == 401) { showSetup = true; return@launch }
                offline = true
                home = (home ?: Home(false, false, emptyList()))
                    .copy(paused = Watching.pausedNow(ctx), backAt = Watching.backAt(ctx), searchEnabled = false, picks = emptyList())
                if (home?.paused == true) results = null
            }
        }
    }

    private var rulesRev: String? = null

    /** Loads the Saved tab: saved videos and History, both without anything blocked since. */
    fun refreshSaved() {
        val a = api ?: return
        val ctx = getApplication<Application>()
        savedJob?.cancel()
        savedJob = viewModelScope.launch {
            try {
                // Both at once; if either fails, the catch below handles it.
                val (saved, watched) = coroutineScope {
                    val s = async { a.saved() }
                    val h = async { a.history() }
                    s.await() to h.await()
                }
                if (saved == null || watched == null) {
                    home = home?.copy(paused = true)
                } else {
                    savedVideos = saved
                    history = watched
                    prefs.savedIds = saved.map { it.id }.toSet()
                }
                if (offline) refreshHome()
            } catch (e: ApiException) {
                if (e.code == 401) showSetup = true
                else { offline = true; message = e.message; home = home ?: Home(Watching.pausedNow(ctx), false, emptyList(), Watching.backAt(ctx)) }
            }
        }
    }

    /** [quiet] = refresh the results in place (after a rules change) without a loading spinner. */
    fun search(q: String, quiet: Boolean = false) {
        val a = api ?: return
        val query = q.trim()
        if (query.isEmpty()) return
        job?.cancel()
        job = viewModelScope.launch {
            if (!quiet) { loading = true; message = null }
            searchedFor = query
            try {
                val r = a.search(query)
                when {
                    r.paused -> { home = home?.copy(paused = true); results = null }
                    r.blocked -> { results = emptyList(); message = "Let's search for something else!" }
                    r.results.isEmpty() -> { results = emptyList(); message = "Nothing found. Try different words!" }
                    else -> { results = r.results; message = null }
                }
            } catch (e: ApiException) {
                if (!quiet) { results = emptyList(); message = e.message }
            } finally {
                loading = false
            }
        }
    }

    fun clearSearch() { job?.cancel(); results = null; message = null; loading = false; searchedFor = "" }

    suspend fun pair(server: String, code: String, name: String): String? {
        val base = Api.normalize(server)
        return try {
            val token = Api(base, null).pair(code.trim(), name.trim())
            prefs.server = base; prefs.token = token; prefs.deviceName = name.trim()
            api = Api(base, token)
            Library.schedule(getApplication())
            showSetup = false; home = null; results = null; message = null
            refreshHome()
            null
        } catch (e: ApiException) {
            e.message
        }
    }

    val savedServer get() = prefs.server?.removePrefix("http://") ?: ""
    val savedName get() = prefs.deviceName ?: ""
}

// ------------------------------------------------------------------ screens

@Composable
fun App(vm: KidViewModel = viewModel()) {
    val tick by MainActivity.resumeTick
    LaunchedEffect(tick, vm.api) { vm.refreshHome() }
    val pending by MainActivity.pendingPair
    LaunchedEffect(pending) { if (pending != null) vm.showSetup = true }

    if (vm.showSetup) {
        SetupScreen(vm, canCancel = vm.api != null)
    } else {
        KidsScreen(vm)
    }
    // Silent check; it only shows something when there's a new version (or after "Check for updates").
    UpdatePrompt(vm.updateCheck) { vm.updateNote = "KidView is up to date." }
}

@Composable
fun VideoCard(v: Video, api: Api, onClick: () -> Unit) {
    val context = LocalContext.current
    val localThumb = remember(v.id) { Library.thumbFile(context, v.id).takeIf { it.exists() } }
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Box {
            AsyncImage(
                model = localThumb ?: api.thumbnail(v.id), contentDescription = null, contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(Color(0xFFE9E3FA)),
            )
            v.duration?.let {
                Text(formatDuration(it), color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.align(Alignment.BottomEnd).padding(8.dp)
                        .background(Color(0xCC000000), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp))
            }
        }
        Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
            Text(v.title, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis, color = Color(0xFF1D1B2E))
            Spacer(Modifier.height(4.dp))
            Text(v.channel, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Color(0xFF6B6880))
        }
    }
}

@Composable
fun BigMessage(emoji: String, title: String, sub: String, action: Pair<String, () -> Unit>? = null) {
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text(emoji, fontSize = 64.sp)
        Spacer(Modifier.height(12.dp))
        Text(title, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = PurpleDark, textAlign = TextAlign.Center)
        if (sub.isNotBlank()) {
            Spacer(Modifier.height(6.dp))
            Text(sub, fontSize = 16.sp, color = Color(0xFF6B6880), textAlign = TextAlign.Center)
        }
        if (action != null) {
            Spacer(Modifier.height(20.dp))
            Button(onClick = action.second, shape = CircleShape,
                colors = ButtonDefaults.buttonColors(containerColor = Sunny, contentColor = PurpleDark)) {
                Text(action.first, fontSize = 17.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
            }
        }
    }
}

@Composable
fun SetupScreen(vm: KidViewModel, canCancel: Boolean) {
    var server by rememberSaveable { mutableStateOf(vm.savedServer) }
    var code by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf(vm.savedName) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    // Details from the dashboard's QR code: scanned here, or opened from the phone's camera.
    fun usePair(p: PairInfo) { server = p.server; code = p.code.take(6); error = null }
    val scanner = rememberLauncherForActivityResult(ScanContract()) { r ->
        val p = parsePairLink(r.contents)
        if (p != null) usePair(p) else if (r.contents != null) error = "That isn't a KidView setup code."
    }
    val pending by MainActivity.pendingPair
    LaunchedEffect(pending) { pending?.let { usePair(it); MainActivity.pendingPair.value = null } }

    BackHandler(enabled = canCancel) { vm.showSetup = false }

    Box(Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()),
        contentAlignment = Alignment.Center) {
        Card(
            Modifier.widthIn(max = 460.dp).fillMaxWidth().padding(20.dp),
            shape = RoundedCornerShape(24.dp),
            colors = CardDefaults.cardColors(containerColor = Color.White),
        ) {
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Grown-up setup", fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, color = PurpleDark)
                Text("Open the KidView dashboard (or the KidView Parent app's Settings) and scan the code, or type the server address and family code.",
                    color = Color(0xFF6B6880))
                OutlinedButton(
                    onClick = {
                        scanner.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                            .setPrompt("Point the camera at the KidView setup code").setBeepEnabled(false).setOrientationLocked(false))
                    },
                    modifier = Modifier.fillMaxWidth(), shape = CircleShape,
                ) { Text("Scan code", fontSize = 16.sp) }
                OutlinedTextField(server, { server = it }, label = { Text("Server address") },
                    placeholder = { Text("192.168.1.20:8765") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
                OutlinedTextField(code, { code = it.filter(Char::isDigit).take(6) }, label = { Text("Family code") },
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
                OutlinedTextField(name, { name = it.take(40) }, label = { Text("Name for this device") },
                    placeholder = { Text("Emma's tablet") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                error?.let { Text(it, color = Color(0xFFC43D3D)) }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(
                        onClick = {
                            busy = true; error = null
                            scope.launch {
                                error = vm.pair(server, code, name.ifBlank { "Kid's device" })
                                busy = false
                            }
                        },
                        enabled = !busy && server.isNotBlank() && code.length == 6,
                        shape = CircleShape,
                        colors = ButtonDefaults.buttonColors(containerColor = Purple),
                    ) { Text(if (busy) "Connecting…" else "Connect", fontSize = 16.sp) }
                    if (canCancel) TextButton(onClick = { vm.showSetup = false }) { Text("Cancel") }
                }
                HorizontalDivider(Modifier.padding(top = 4.dp), color = Color(0xFFECEAF4))
                val ctx = LocalContext.current
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("KidView ${Updater.currentVersion(ctx)}", color = Color(0xFF6B6880), fontSize = 14.sp,
                        modifier = Modifier.weight(1f))
                    TextButton(onClick = { vm.updateNote = null; vm.updateCheck++ }) { Text("Check for updates") }
                }
                vm.updateNote?.let { Text(it, color = Color(0xFF6B6880), fontSize = 14.sp) }
            }
        }
    }
}

fun formatDuration(seconds: Int): String {
    val h = seconds / 3600; val m = seconds % 3600 / 60; val s = seconds % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}
