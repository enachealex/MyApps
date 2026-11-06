package com.family.kidview

import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

/**
 * Full-screen player. Plays one video and stops: no autoplay, no related videos,
 * no links out to YouTube. Everything streams through the home server.
 */
@OptIn(UnstableApi::class)
class PlayerActivity : ComponentActivity() {
    private var player: ExoPlayer? = null
    private val state = mutableStateOf<UiState>(UiState.Loading)

    sealed interface UiState {
        data object Loading : UiState
        data object Playing : UiState
        data class Message(val emoji: String, val title: String, val sub: String) : UiState
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }

        val api = Api.from(this) ?: return finish()
        val id = intent.getStringExtra("id") ?: return finish()
        val exo = ExoPlayer.Builder(this).build().also { player = it }

        exo.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(s: Int) {
                if (s == Player.STATE_READY && state.value == UiState.Loading) state.value = UiState.Playing
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
                PlayerScreen(exo, state.value) { finish() }
            }
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
        super.onDestroy()
    }
}

@OptIn(UnstableApi::class)
@Composable
private fun PlayerScreen(exo: ExoPlayer, state: PlayerActivity.UiState, onClose: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    player = exo
                    setShowNextButton(false)
                    setShowPreviousButton(false)
                    setShowSubtitleButton(true)
                    controllerShowTimeoutMs = 2500
                }
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

        if (state !is PlayerActivity.UiState.Message) {
            FilledIconButton(
                onClick = onClose,
                modifier = Modifier.align(Alignment.TopStart).padding(16.dp).size(48.dp),
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = Color(0x66000000), contentColor = Color.White),
            ) { Icon(painterResource(R.drawable.ic_close), "Close") }
        }
    }
}
