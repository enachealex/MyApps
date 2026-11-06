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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val Purple = Color(0xFF6C4BF4)
private val PurpleDark = Color(0xFF3B2A8C)
private val Lavender = Color(0xFFF7F2FF)
private val Sunny = Color(0xFFFFC93C)

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
    var saved by mutableStateOf(Library.saved(app))
    var recommended by mutableStateOf<List<Pair<String, List<Video>>>>(emptyList())
    var offline by mutableStateOf(false)
    private var job: Job? = null

    init {
        // When a background sync finishes, show the newly saved videos.
        val wm = WorkManager.getInstance(app)
        for (name in listOf(Library.SYNC_NOW, Library.SYNC_PERIODIC)) {
            viewModelScope.launch {
                wm.getWorkInfosForUniqueWorkFlow(name).collect { saved = Library.saved(app) }
            }
        }
    }

    fun refreshHome() {
        val a = api ?: return
        val ctx = getApplication<Application>()
        saved = Library.saved(ctx)
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
                saved = Library.saved(ctx)
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
        HomeScreen(vm)
    }
    // Silent check; it only shows something when there's a new version (or after "Check for updates").
    UpdatePrompt(vm.updateCheck) { vm.updateNote = "KidView is up to date." }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun HomeScreen(vm: KidViewModel) {
    val context = LocalContext.current
    val focus = LocalFocusManager.current
    var query by rememberSaveable { mutableStateOf("") }
    val home = vm.home
    val api = vm.api ?: return

    BackHandler(enabled = vm.results != null) { vm.clearSearch(); query = "" }

    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            vm.recheck()
        }
    }

    val voice = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val heard = r.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (!heard.isNullOrBlank()) { query = heard; vm.search(heard) }
    }
    val voiceIntent = remember {
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "What do you want to watch?")
    }
    val canVoice = remember { voiceIntent.resolveActivity(context.packageManager) != null }

    fun open(v: Video) {
        context.startActivity(Intent(context, PlayerActivity::class.java)
            .putExtra("id", v.id).putExtra("title", v.title).putExtra("channel", v.channel))
    }

    Column(Modifier.fillMaxSize().systemBarsPadding()) {
        // Header. A grown-up can long-press the name to change the server or re-pair.
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(Purple), contentAlignment = Alignment.Center) {
                Text("▶", color = Color.White, fontSize = 16.sp)
            }
            Spacer(Modifier.width(10.dp))
            Text("KidView", fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, color = PurpleDark,
                modifier = Modifier.combinedClickable(
                    interactionSource = remember { MutableInteractionSource() }, indication = null,
                    onClick = {}, onLongClick = { vm.showSetup = true }))
        }

        if (home?.paused != true && home?.searchEnabled != false) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                TextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Search for videos", fontSize = 18.sp) },
                    singleLine = true,
                    textStyle = LocalTextStyle.current.copy(fontSize = 18.sp),
                    shape = RoundedCornerShape(30.dp),
                    leadingIcon = { Icon(painterResource(R.drawable.ic_search), null, tint = Purple) },
                    trailingIcon = if (query.isNotEmpty() || vm.results != null) {
                        { IconButton(onClick = { query = ""; vm.clearSearch() }) { Icon(painterResource(R.drawable.ic_close), "Clear") } }
                    } else null,
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = Color.White, unfocusedContainerColor = Color.White,
                        focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                    ),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { focus.clearFocus(); vm.search(query) }),
                )
                if (canVoice) {
                    Spacer(Modifier.width(10.dp))
                    FilledIconButton(
                        onClick = { try { voice.launch(voiceIntent) } catch (_: ActivityNotFoundException) {} },
                        modifier = Modifier.size(56.dp),
                        colors = IconButtonDefaults.filledIconButtonColors(containerColor = Sunny, contentColor = PurpleDark),
                    ) { Icon(painterResource(R.drawable.ic_mic), "Talk to search", Modifier.size(28.dp)) }
                }
            }
        } else {
            Spacer(Modifier.height(12.dp))
        }

        Box(Modifier.fillMaxSize()) {
            val savedSection = "Saved on this device 📥" to vm.saved
            when {
                home?.paused == true -> BigMessage("🌙", "Video time is over for now", Watching.backText(home?.backAt))
                vm.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center), color = Purple)
                vm.results != null && vm.results!!.isEmpty() -> BigMessage("🔍", vm.message ?: "Nothing found", "")
                vm.results != null -> VideoGrid(listOf("Videos for “${vm.searchedFor}”" to vm.results!!), api, ::open)
                home == null -> CircularProgressIndicator(Modifier.align(Alignment.Center), color = Purple)
                vm.offline && vm.saved.isNotEmpty() -> VideoGrid(listOf(savedSection), api, ::open,
                    banner = "No internet right now, but you can watch your saved videos!")
                vm.offline -> BigMessage("📡", "Can't connect", vm.message ?: "")
                home.picks.isNotEmpty() || vm.saved.isNotEmpty() || vm.recommended.isNotEmpty() -> VideoGrid(
                    (listOf("Picks from your grown-up 💜" to home.picks) + vm.recommended + listOf(savedSection))
                        .filter { it.second.isNotEmpty() }, api, ::open)
                home.searchEnabled -> BigMessage("🎈", "What do you want to watch?", "Type or tap the microphone to search.")
                else -> BigMessage("⭐", "No videos yet", "Ask a grown-up to pick some videos for you.")
            }
        }
    }
}

@Composable
fun VideoGrid(sections: List<Pair<String, List<Video>>>, api: Api, onOpen: (Video) -> Unit, banner: String? = null) {
    LazyVerticalGrid(
        columns = GridCells.Adaptive(240.dp),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (banner != null) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Text(banner, color = PurpleDark, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.background(Sunny.copy(alpha = 0.35f), RoundedCornerShape(14.dp)).padding(14.dp).fillMaxWidth())
            }
        }
        sections.forEach { (title, videos) ->
            item(span = { GridItemSpan(maxLineSpan) }) {
                Text(title, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = PurpleDark, modifier = Modifier.padding(top = 4.dp, bottom = 2.dp))
            }
            items(videos, key = { title + it.id }) { v -> VideoCard(v, api) { onOpen(v) } }
        }
    }
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
fun BigMessage(emoji: String, title: String, sub: String) {
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text(emoji, fontSize = 64.sp)
        Spacer(Modifier.height(12.dp))
        Text(title, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = PurpleDark, textAlign = TextAlign.Center)
        if (sub.isNotBlank()) {
            Spacer(Modifier.height(6.dp))
            Text(sub, fontSize = 16.sp, color = Color(0xFF6B6880), textAlign = TextAlign.Center)
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
