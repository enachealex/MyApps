package com.family.kidview

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.annotation.OptIn
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.MergingMediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.ui.PlayerView
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

/**
 * Full-screen player. Plays one video and stops: no autoplay, no links out to YouTube. Everything
 * streams through the home server.
 *
 * While a video plays, nothing covers it: no close button, no controls, no phone bars. A tap brings
 * them all back, plus a row of other videos peeking up from the bottom; tapping that row slides it up
 * to show the whole thumbnails and names. The videos come from the same filtered recommendations as
 * the home screen (or the saved videos when there's no internet).
 */
@OptIn(UnstableApi::class)
class PlayerActivity : ComponentActivity() {
    private var player: ExoPlayer? = null
    private var playerView: PlayerView? = null
    private val state = mutableStateOf<UiState>(UiState.Loading)
    private val controlsVisible = mutableStateOf(false)
    private val more = mutableStateOf<List<Video>>(emptyList())

    sealed interface UiState {
        data object Loading : UiState
        data object Playing : UiState
        data class Message(val emoji: String, val title: String, val sub: String) : UiState
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // Draw behind the phone's bars, so the video doesn't jump when they appear.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        showSystemBars(false)

        val api = Api.from(this) ?: return finish()
        val id = intent.getStringExtra("id") ?: return finish()
        val exo = ExoPlayer.Builder(this).build().also { player = it }

        exo.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(s: Int) {
                if (s == Player.STATE_READY && state.value == UiState.Loading) {
                    state.value = UiState.Playing
                    playerView?.hideController()   // start with nothing over the video
                }
                if (s == Player.STATE_ENDED) state.value = UiState.Message("🎉", "All done!", "Pick another video when you're ready.")
            }

            override fun onPlayerError(error: PlaybackException) {
                // Most likely a grown-up blocked this video or watching time ended.
                lifecycleScope.launch {
                    val paused = runCatching { api.home().also { Watching.save(this@PlayerActivity, it.raw) }.paused }
                        .getOrDefault(Watching.pausedNow(this@PlayerActivity))
                    state.value = if (paused) timeIsOver()
                    else UiState.Message("🙈", "This video stopped", "Let's pick a different one.")
                }
            }
        })

        setContent {
            MaterialTheme {
                PlayerScreen(
                    exo = exo,
                    state = state.value,
                    controlsVisible = controlsVisible.value,
                    more = more.value,
                    api = api,
                    onPlayerView = { view ->
                        playerView = view
                        view.setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { visibility ->
                            val visible = visibility == View.VISIBLE
                            controlsVisible.value = visible
                            showSystemBars(visible)
                        })
                    },
                    onKeepControls = { keep ->
                        // While the row of videos is open, leave everything on screen until a choice is made.
                        playerView?.apply {
                            controllerShowTimeoutMs = if (keep) 0 else CONTROLS_TIMEOUT_MS
                            showController()
                        }
                    },
                    onPlay = { v -> playNext(v) },
                    onClose = { finish() },
                )
            }
        }

        // Other videos for the row at the bottom.
        lifecycleScope.launch {
            val videos = runCatching { api.recommended().flatMap { it.second } }.getOrDefault(emptyList())
                .ifEmpty { Library.saved(this@PlayerActivity) }
            more.value = videos.filter { it.id != id }.distinctBy { it.id }.take(20)
        }

        // Watching time can end mid-video, even with no internet (saved videos).
        lifecycleScope.launch {
            while (true) {
                delay(20_000)
                if (state.value !is UiState.Message && Watching.pausedNow(this@PlayerActivity)) {
                    exo.pause()
                    state.value = timeIsOver()
                }
            }
        }

        val saved = Library.videoFile(this, id)
        if (saved.exists()) {
            // A saved video: play it from this device. Still respect watching time.
            lifecycleScope.launch {
                val paused = try {
                    withTimeout(4_000) { api.home().also { Watching.save(this@PlayerActivity, it.raw) }.paused }
                } catch (e: Exception) {
                    Watching.pausedNow(this@PlayerActivity)
                }
                if (paused) {
                    state.value = timeIsOver()
                } else {
                    exo.setMediaItem(MediaItem.fromUri(Uri.fromFile(saved)))
                    exo.prepare()
                    exo.playWhenReady = true
                    Library.recordWatched(this@PlayerActivity,
                        Video(id, intent.getStringExtra("title").orEmpty(), intent.getStringExtra("channel").orEmpty(), null))
                    runCatching { Library.uploadWatched(this@PlayerActivity, api) }
                }
            }
            return
        }

        lifecycleScope.launch {
            try {
                val play = api.play(id)
                when {
                    play.paused -> {
                        runCatching { Watching.save(this@PlayerActivity, api.home().raw) }
                        state.value = timeIsOver()
                    }
                    !play.allowed || play.streams.isEmpty() ->
                        state.value = UiState.Message("🙈", "This one isn't available", "Let's pick a different video.")
                    else -> start(exo, api, play)
                }
            } catch (e: ApiException) {
                state.value = UiState.Message("📡", "Can't connect", e.message ?: "")
            }
        }
    }

    private fun showSystemBars(show: Boolean) {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            if (show) show(WindowInsetsCompat.Type.systemBars()) else hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun playNext(v: Video) {
        startActivity(Intent(this, PlayerActivity::class.java)
            .putExtra("id", v.id).putExtra("title", v.title).putExtra("channel", v.channel))
        finish()
    }

    private fun timeIsOver() =
        UiState.Message("🌙", "Video time is over for now", Watching.backText(Watching.backAt(this)))

    private fun start(exo: ExoPlayer, api: Api, play: Play) {
        val http = DefaultHttpDataSource.Factory()
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(60_000)
            .setDefaultRequestProperties(mapOf("Authorization" to "Bearer ${api.token}"))
        val factory = ProgressiveMediaSource.Factory(http)
        // Higher quality videos come as separate picture and sound streams; play them together.
        val sources = play.streams.map { factory.createMediaSource(MediaItem.fromUri(it)) }
        val source = if (sources.size == 1) sources[0] else MergingMediaSource(true, true, *sources.toTypedArray())
        exo.setMediaSource(source)
        exo.prepare()
        exo.playWhenReady = true
    }

    override fun onStop() {
        super.onStop()
        player?.pause()
    }

    override fun onDestroy() {
        player?.release()
        player = null
        playerView = null
        super.onDestroy()
    }

    companion object {
        const val CONTROLS_TIMEOUT_MS = 3000
    }
}

// Sizes of the row of other videos.
private val THUMB_W = 168.dp
private val THUMB_H = THUMB_W * 9 / 16
private val HANDLE_H = 22.dp
private val TITLE_H = 40.dp
/** Closed: the handle plus the top quarter of the thumbnails. */
private val ROW_PEEK = HANDLE_H + THUMB_H / 4
/** Open: whole thumbnails and their names. */
private val ROW_OPEN = HANDLE_H + THUMB_H + 6.dp + TITLE_H + 12.dp

@OptIn(UnstableApi::class)
@Composable
private fun PlayerScreen(
    exo: ExoPlayer,
    state: PlayerActivity.UiState,
    controlsVisible: Boolean,
    more: List<Video>,
    api: Api,
    onPlayerView: (PlayerView) -> Unit,
    onKeepControls: (Boolean) -> Unit,
    onPlay: (Video) -> Unit,
    onClose: () -> Unit,
) {
    val density = LocalDensity.current
    val layoutDirection = LocalLayoutDirection.current
    val bars = WindowInsets.systemBars.union(WindowInsets.displayCutout)
    val showRow = controlsVisible && state == PlayerActivity.UiState.Playing && more.isNotEmpty()
    var rowOpen by remember { mutableStateOf(false) }
    LaunchedEffect(showRow) { if (!showRow) rowOpen = false }

    // Keep the player's own controls clear of the phone's bars and of the row of videos.
    val padLeft = with(density) { bars.getLeft(this, layoutDirection) }
    val padTop = with(density) { bars.getTop(this) }
    val padRight = with(density) { bars.getRight(this, layoutDirection) }
    val padBottom = with(density) { bars.getBottom(this) + if (more.isNotEmpty()) ROW_PEEK.roundToPx() else 0 }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    player = exo
                    setShowNextButton(false)
                    setShowPreviousButton(false)
                    setShowSubtitleButton(true)
                    controllerShowTimeoutMs = PlayerActivity.CONTROLS_TIMEOUT_MS
                    onPlayerView(this)
                }
            },
            update = { view ->
                view.findViewById<View>(androidx.media3.ui.R.id.exo_controller)
                    ?.setPadding(padLeft, padTop, padRight, padBottom)
            },
            modifier = Modifier.fillMaxSize(),
        )

        when (state) {
            PlayerActivity.UiState.Loading -> Column(
                Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                CircularProgressIndicator(color = Color.White)
                Spacer(Modifier.height(16.dp))
                Text("Getting your video ready…", color = Color.White, fontSize = 18.sp)
            }
            is PlayerActivity.UiState.Message -> Column(
                Modifier.fillMaxSize().background(Color(0xF0140F2B)).padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
            ) {
                Text(state.emoji, fontSize = 64.sp)
                Spacer(Modifier.height(12.dp))
                Text(state.title, color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                Spacer(Modifier.height(6.dp))
                Text(state.sub, color = Color(0xFFCFC8F0), fontSize = 17.sp, textAlign = TextAlign.Center)
                Spacer(Modifier.height(24.dp))
                Button(onClick = onClose, shape = CircleShape,
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFFC93C), contentColor = Color(0xFF3B2A8C))) {
                    Text("Back to videos", fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
                }
            }
            PlayerActivity.UiState.Playing -> {}
        }

        // The close button: only with the other controls (and while the video is loading).
        AnimatedVisibility(
            visible = state == PlayerActivity.UiState.Loading || (controlsVisible && state == PlayerActivity.UiState.Playing),
            enter = fadeIn(), exit = fadeOut(),
            modifier = Modifier.align(Alignment.TopStart).windowInsetsPadding(bars),
        ) {
            FilledIconButton(
                onClick = onClose,
                modifier = Modifier.padding(16.dp).size(48.dp),
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = Color(0x66000000), contentColor = Color.White),
            ) { Icon(painterResource(R.drawable.ic_close), "Close") }
        }

        // Other videos, peeking up from the bottom.
        AnimatedVisibility(
            visible = showRow,
            enter = slideInVertically { it } + fadeIn(), exit = slideOutVertically { it } + fadeOut(),
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            MoreVideos(
                videos = more,
                open = rowOpen,
                api = api,
                onOpen = { rowOpen = it; onKeepControls(it) },
                onPlay = onPlay,
                bottomInset = bars,
            )
        }
    }
}

@Composable
private fun MoreVideos(
    videos: List<Video>,
    open: Boolean,
    api: Api,
    onOpen: (Boolean) -> Unit,
    onPlay: (Video) -> Unit,
    bottomInset: WindowInsets,
) {
    val context = LocalContext.current
    val height by animateDpAsState(if (open) ROW_OPEN else ROW_PEEK, label = "row height")
    Box(
        Modifier
            .fillMaxWidth()
            .background(Brush.verticalGradient(listOf(Color(0x00000000), Color(0xCC000000))))
            .windowInsetsPadding(bottomInset.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
            .height(height)
            .clipToBounds(),
    ) {
        Column(Modifier.fillMaxWidth().wrapContentHeight(Alignment.Top, unbounded = true).requiredHeight(ROW_OPEN)) {
            // The handle: tap to open or close the row.
            Box(
                Modifier.fillMaxWidth().height(HANDLE_H).clickable { onOpen(!open) },
                contentAlignment = Alignment.Center,
            ) {
                Box(Modifier.size(width = 44.dp, height = 5.dp).clip(CircleShape).background(Color(0xCCFFFFFF)))
            }
            LazyRow(
                contentPadding = PaddingValues(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                userScrollEnabled = open,
            ) {
                items(videos, key = { it.id }) { v ->
                    Column(
                        Modifier.width(THUMB_W).clip(RoundedCornerShape(12.dp))
                            // Closed, a tap anywhere opens the row; open, a tap plays that video.
                            .clickable { if (open) onPlay(v) else onOpen(true) },
                    ) {
                        val saved = remember(v.id) { Library.thumbFile(context, v.id).takeIf { it.exists() } }
                        AsyncImage(
                            model = saved ?: api.thumbnail(v.id),
                            contentDescription = v.title,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.size(THUMB_W, THUMB_H).clip(RoundedCornerShape(12.dp)).background(Color(0xFF2A2546)),
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(
                            v.title, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                            maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 18.sp,
                            modifier = Modifier.height(TITLE_H),
                        )
                    }
                }
            }
        }
        // Closed: the whole strip is one big "open" button, so small fingers can't miss.
        if (!open) {
            Box(
                Modifier.matchParentSize().clickable(
                    interactionSource = remember { MutableInteractionSource() }, indication = null,
                ) { onOpen(true) },
            )
        }
    }
}
