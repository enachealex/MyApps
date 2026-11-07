package com.family.kidview

import android.content.ActivityNotFoundException
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.DrawableRes
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.roundToInt

private val Muted = Color(0xFF6B6880)

/** The tabs along the bottom of the kids' app. */
enum class Tab(val label: String, @DrawableRes val icon: Int) {
    Home("Home", R.drawable.ic_home),
    Saved("Saved", R.drawable.ic_heart),
    Offline("Offline", R.drawable.ic_offline),
}

/**
 * The bar at the top of each tab. Scrolling down through the videos slides it up until only its
 * bottom quarter peeks out; tapping what's left brings it back down. Scrolling back to the top of
 * the list brings it back too.
 */
@Stable
class HidingBarState {
    var height by mutableIntStateOf(0)
    private var rawOffset by mutableFloatStateOf(0f)
    /** True once the list has scrolled at all, so the bar casts a shadow over it. */
    var overList by mutableStateOf(false)
        private set
    private var anim: Job? = null

    private val maxHide get() = height * 0.75f
    /** How far the bar has slid up, in pixels (0 or less). */
    val offset get() = rawOffset.coerceAtLeast(-maxHide)
    /** Mostly out of sight: a tap on what's left brings it back. */
    val tucked get() = height > 0 && offset < -maxHide * 0.3f

    /** Slides the bar up along with the videos as they scroll up. */
    val connection = object : NestedScrollConnection {
        override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
            if (consumed.y < 0f) slideTo(offset + consumed.y)
            return Offset.Zero
        }
    }

    private fun slideTo(value: Float) {
        anim?.cancel()
        rawOffset = value.coerceIn(-maxHide, 0f)
    }

    /** Near the top of the list the bar never sits higher than the videos, so there's no gap. */
    fun followList(distanceFromTop: Float) {
        overList = distanceFromTop > 0f
        if (offset < -distanceFromTop) slideTo(-distanceFromTop)
    }

    fun show(scope: CoroutineScope) {
        if (offset == 0f) return
        anim?.cancel()
        anim = scope.launch { animate(offset, 0f, animationSpec = tween(220)) { v, _ -> rawOffset = v } }
    }

    fun reset() {
        anim?.cancel()
        rawOffset = 0f
        overList = false
    }
}

@Composable
fun KidsScreen(vm: KidViewModel) {
    val context = LocalContext.current
    val bar = remember { HidingBarState() }
    // Each tab keeps its own search text and scroll position while another tab is showing.
    val tabs = rememberSaveableStateHolder()

    LaunchedEffect(vm.tab) {
        bar.reset()
        if (vm.tab == Tab.Saved) vm.refreshSaved()
    }
    BackHandler(enabled = vm.tab != Tab.Home) { vm.tab = Tab.Home }
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            vm.recheck()
        }
    }
    val api = vm.api ?: return

    fun open(v: Video) {
        context.startActivity(Intent(context, PlayerActivity::class.java)
            .putExtra("id", v.id).putExtra("title", v.title).putExtra("channel", v.channel))
    }

    val sides = WindowInsets.systemBars.union(WindowInsets.displayCutout)
    Column(Modifier.fillMaxSize().windowInsetsPadding(sides.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))) {
        Box(Modifier.weight(1f).fillMaxWidth().clipToBounds().nestedScroll(bar.connection)) {
            tabs.SaveableStateProvider(vm.tab.name) {
                when (vm.tab) {
                    Tab.Home -> HomeTab(vm, api, bar, ::open)
                    Tab.Saved -> SavedTab(vm, api, bar, ::open)
                    Tab.Offline -> OfflineTab(vm, api, bar, ::open)
                }
            }
        }
        TabBar(vm.tab) { vm.tab = it }
    }
}

// ------------------------------------------------------------------ the three tabs

@Composable
private fun HomeTab(vm: KidViewModel, api: Api, bar: HidingBarState, open: (Video) -> Unit) {
    val context = LocalContext.current
    val focus = LocalFocusManager.current
    val scope = rememberCoroutineScope()
    var query by rememberSaveable { mutableStateOf(vm.searchedFor) }
    val home = vm.home
    val homeGrid = rememberLazyGridState()
    val resultsGrid = rememberLazyGridState()
    LaunchedEffect(vm.searchedFor) { resultsGrid.scrollToItem(0) }

    BackHandler(enabled = vm.results != null) { vm.clearSearch(); query = "" }

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
    val searchOn = home?.paused != true && home?.searchEnabled != false
    val wide = LocalConfiguration.current.screenWidthDp >= 560

    TabPage(bar, header = {
        Logo(vm, showName = wide || !searchOn)
        if (searchOn) {
            Spacer(Modifier.width(14.dp))
            TextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier.weight(1f).onFocusChanged { if (it.isFocused) bar.show(scope) },
                placeholder = { Text(if (wide) "Search for videos" else "Search", fontSize = 18.sp, maxLines = 1) },
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
    }) { top ->
        when {
            home?.paused == true -> Centered(top, bar) { BigMessage("🌙", "Video time is over for now", Watching.backText(home.backAt)) }
            vm.loading -> Centered(top, bar) { CircularProgressIndicator(color = Purple) }
            vm.results != null && vm.results!!.isEmpty() -> Centered(top, bar) { BigMessage("🔍", vm.message ?: "Nothing found", "") }
            vm.results != null -> VideoGrid(listOf("Videos for “${vm.searchedFor}”" to vm.results!!), api, open, resultsGrid, top, bar)
            home == null -> Centered(top, bar) { CircularProgressIndicator(color = Purple) }
            vm.offline -> Centered(top, bar) { NoInternet(vm, vm.message ?: "") }
            home.picks.isNotEmpty() || vm.recommended.isNotEmpty() -> VideoGrid(
                (listOf("Picks from your grown-up 💜" to home.picks) + vm.recommended).filter { it.second.isNotEmpty() },
                api, open, homeGrid, top, bar)
            home.searchEnabled -> Centered(top, bar) { BigMessage("🎈", "What do you want to watch?", "Type or tap the microphone to search.") }
            else -> Centered(top, bar) { BigMessage("⭐", "No videos yet", "Ask a grown-up to pick some videos for you.") }
        }
    }
}

@Composable
private fun SavedTab(vm: KidViewModel, api: Api, bar: HidingBarState, open: (Video) -> Unit) {
    val savedGrid = rememberLazyGridState()
    val historyGrid = rememberLazyGridState()
    val wide = LocalConfiguration.current.screenWidthDp >= 480

    TabPage(bar, header = {
        Logo(vm, showName = wide)
        Spacer(Modifier.width(16.dp))
        // Saved and History: two pages of this tab.
        Pill("Saved", R.drawable.ic_heart, selected = !vm.showHistory) { vm.showHistory = false }
        Spacer(Modifier.width(8.dp))
        Pill("History", R.drawable.ic_history, selected = vm.showHistory) { vm.showHistory = true }
    }) { top ->
        val list = if (vm.showHistory) vm.history?.map { it.video } else vm.savedVideos
        when {
            vm.home?.paused == true -> Centered(top, bar) { BigMessage("🌙", "Video time is over for now", Watching.backText(vm.home?.backAt)) }
            vm.offline -> Centered(top, bar) { NoInternet(vm, "Saved videos and History need the home Wi-Fi.") }
            list == null -> Centered(top, bar) { CircularProgressIndicator(color = Purple) }
            list.isEmpty() && vm.showHistory -> Centered(top, bar) { BigMessage("🕘", "Nothing here yet", "Videos you watch will show up here.") }
            list.isEmpty() -> Centered(top, bar) { BigMessage("❤️", "No saved videos yet", "Tap the heart while you're watching a video to save it here.") }
            vm.showHistory -> VideoGrid(byDay(vm.history.orEmpty()), api, open, historyGrid, top, bar)
            else -> VideoGrid(listOf("" to list), api, open, savedGrid, top, bar)
        }
    }
}

@Composable
private fun OfflineTab(vm: KidViewModel, api: Api, bar: HidingBarState, open: (Video) -> Unit) {
    val grid = rememberLazyGridState()
    val wide = LocalConfiguration.current.screenWidthDp >= 480
    TabPage(bar, header = {
        Logo(vm, showName = wide)
        Spacer(Modifier.width(16.dp))
        Text("Videos on this device", fontSize = 19.sp, fontWeight = FontWeight.Bold, color = PurpleDark,
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(vertical = 14.dp))
    }) { top ->
        when {
            vm.home?.paused == true -> Centered(top, bar) { BigMessage("🌙", "Video time is over for now", Watching.backText(vm.home?.backAt)) }
            vm.onDevice.isEmpty() -> Centered(top, bar) {
                BigMessage("📥", "No offline videos yet",
                    "A grown-up can pick videos to keep on this device. They download when it's on home Wi-Fi, and then they work without internet.")
            }
            else -> VideoGrid(listOf("" to vm.onDevice), api, open, grid, top, bar,
                banner = if (vm.offline) "No internet right now, but these videos still work!" else null)
        }
    }
}

/** "Can't connect", with a way to the Offline tab when there are videos on the device. */
@Composable
private fun NoInternet(vm: KidViewModel, sub: String) {
    if (vm.onDevice.isNotEmpty()) {
        BigMessage("📡", "No internet right now", "Your Offline videos still work!", action = "Watch Offline videos" to { vm.tab = Tab.Offline })
    } else {
        BigMessage("📡", "Can't connect", sub)
    }
}

/** History grouped into Today, Yesterday, then days of the week. */
private fun byDay(list: List<Watched>): List<Pair<String, List<Video>>> {
    val zone = ZoneId.systemDefault()
    val today = LocalDate.now(zone)
    return list.groupBy { Instant.ofEpochSecond(it.at).atZone(zone).toLocalDate() }.map { (day, items) ->
        val label = when {
            day == today -> "Today"
            day == today.minusDays(1) -> "Yesterday"
            day.isAfter(today.minusDays(7)) -> day.dayOfWeek.getDisplayName(TextStyle.FULL, Locale.getDefault())
            else -> day.format(DateTimeFormatter.ofPattern("MMMM d", Locale.getDefault()))
        }
        label to items.map { it.video }
    }
}

// ------------------------------------------------------------------ pieces

/** A tab's page: its bar at the top (which hides as the videos scroll) over its content. */
@Composable
private fun TabPage(bar: HidingBarState, header: @Composable RowScope.() -> Unit, body: @Composable (top: Dp) -> Unit) {
    val top = with(LocalDensity.current) { bar.height.toDp() }
    Box(Modifier.fillMaxSize()) {
        body(top)
        HidingBar(bar, header)
    }
}

@Composable
private fun HidingBar(state: HidingBarState, content: @Composable RowScope.() -> Unit) {
    val scope = rememberCoroutineScope()
    Box(
        Modifier
            .fillMaxWidth()
            .onSizeChanged { state.height = it.height }
            .offset { IntOffset(0, state.offset.roundToInt()) }
            .shadow(if (state.overList || state.offset < 0f) 4.dp else 0.dp)
            .background(Lavender),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            content = content,
        )
        if (state.tucked) {
            // Only the bottom of the bar shows: tap it to bring the bar back down.
            Box(
                Modifier.matchParentSize().clickable(
                    interactionSource = remember { MutableInteractionSource() }, indication = null,
                    onClickLabel = "Show the search bar",
                ) { state.show(scope) },
            )
            Box(
                Modifier.align(Alignment.BottomCenter).padding(bottom = 4.dp).size(width = 44.dp, height = 4.dp)
                    .clip(CircleShape).background(PurpleDark.copy(alpha = 0.35f)),
            )
        }
    }
}

/** For anything that isn't a list of videos: centred below the bar, and the bar fully showing. */
@Composable
private fun Centered(top: Dp, bar: HidingBarState, content: @Composable BoxScope.() -> Unit) {
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { bar.show(scope) }
    Box(Modifier.fillMaxSize().padding(top = top), contentAlignment = Alignment.Center, content = content)
}

/** The app's name. A grown-up can long-press it to change the server or re-pair. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Logo(vm: KidViewModel, showName: Boolean) {
    Row(
        Modifier.combinedClickable(
            interactionSource = remember { MutableInteractionSource() }, indication = null,
            onClick = {}, onLongClick = { vm.showSetup = true },
        ),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(Purple), contentAlignment = Alignment.Center) {
            Text("▶", color = Color.White, fontSize = 16.sp)
        }
        if (showName) {
            Spacer(Modifier.width(10.dp))
            Text("KidView", fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, color = PurpleDark, maxLines = 1)
        }
    }
}

@Composable
private fun Pill(label: String, @DrawableRes icon: Int, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = if (selected) Purple else Color.White,
        contentColor = if (selected) Color.White else PurpleDark,
        shadowElevation = if (selected) 0.dp else 1.dp,
    ) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(painterResource(icon), null, Modifier.size(20.dp))
            Spacer(Modifier.width(6.dp))
            Text(label, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun TabBar(current: Tab, onSelect: (Tab) -> Unit) {
    // A phone on its side has little height to spare.
    val short = LocalConfiguration.current.screenHeightDp < 480
    Surface(color = Color.White, shadowElevation = 8.dp) {
        Row(
            Modifier.fillMaxWidth()
                .windowInsetsPadding(WindowInsets.navigationBars.only(WindowInsetsSides.Bottom))
                .height(if (short) 50.dp else 60.dp)
                .padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Tab.entries.forEach { t ->
                val on = t == current
                Box(
                    Modifier.weight(1f).fillMaxHeight()
                        .selectable(selected = on, role = Role.Tab, onClick = { onSelect(t) }),
                    contentAlignment = Alignment.Center,
                ) {
                    Row(
                        Modifier.clip(CircleShape).background(if (on) Purple.copy(alpha = 0.13f) else Color.Transparent)
                            .padding(horizontal = 16.dp, vertical = if (short) 6.dp else 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(painterResource(t.icon), null, Modifier.size(24.dp), tint = if (on) Purple else Muted)
                        Spacer(Modifier.width(8.dp))
                        Text(t.label, fontSize = 16.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Medium,
                            color = if (on) PurpleDark else Muted)
                    }
                }
            }
        }
    }
}

/** Rows of video cards under section titles (a section with no title has no heading). */
@Composable
fun VideoGrid(
    sections: List<Pair<String, List<Video>>>,
    api: Api,
    onOpen: (Video) -> Unit,
    state: LazyGridState = rememberLazyGridState(),
    top: Dp = 0.dp,
    bar: HidingBarState? = null,
    banner: String? = null,
) {
    if (bar != null) {
        LaunchedEffect(state, bar) {
            snapshotFlow { if (state.firstVisibleItemIndex == 0) state.firstVisibleItemScrollOffset.toFloat() else Float.MAX_VALUE }
                .collect { bar.followList(it) }
        }
    }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(240.dp),
        state = state,
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = top, bottom = 24.dp),
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
            if (title.isNotEmpty()) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Text(title, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = PurpleDark, modifier = Modifier.padding(top = 4.dp, bottom = 2.dp))
                }
            }
            items(videos, key = { title + it.id }) { v -> VideoCard(v, api) { onOpen(v) } }
        }
    }
}
