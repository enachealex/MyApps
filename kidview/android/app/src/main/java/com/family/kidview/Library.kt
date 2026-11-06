package com.family.kidview

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Saved videos for watching without internet.
 *
 * The home server decides what's in the library. This device copies it over Wi-Fi, keeps a
 * local list, deletes anything the server no longer has (removed or blocked), and reports
 * videos watched offline the next time it can reach the server.
 */
object Library {
    private val lock = Mutex()

    private fun dir(ctx: Context) = File(ctx.filesDir, "library").apply { mkdirs() }
    fun videoFile(ctx: Context, id: String) = File(dir(ctx), "$id.mp4")
    fun thumbFile(ctx: Context, id: String) = File(dir(ctx), "$id.jpg")
    private fun manifestFile(ctx: Context) = File(dir(ctx), "manifest.json")
    private fun watchedFile(ctx: Context) = File(ctx.filesDir, "watched-offline.json")

    /** Saved videos that are fully downloaded, newest first. Works with no connection. */
    fun saved(ctx: Context): List<Video> {
        val f = manifestFile(ctx)
        if (!f.exists()) return emptyList()
        val items = runCatching { JSONObject(f.readText()).getJSONArray("items") }.getOrNull() ?: return emptyList()
        return buildList {
            for (i in 0 until items.length()) {
                val o = items.getJSONObject(i)
                val id = o.getString("id")
                if (videoFile(ctx, id).exists()) {
                    add(Video(id, o.optString("title"), o.optString("channel"), if (o.isNull("duration")) null else o.optInt("duration")))
                }
            }
        }
    }

    /** Fetch the server's list, save it, and delete anything that was removed. Quick: no downloads. */
    suspend fun refresh(ctx: Context, api: Api): JSONArray = withContext(Dispatchers.IO) {
        val manifest = api.library()
        val items = manifest.getJSONArray("items")
        Watching.save(ctx, manifest)
        val keep = buildSet { for (i in 0 until items.length()) add(items.getJSONObject(i).getString("id")) }
        dir(ctx).listFiles()?.forEach { f ->
            val id = f.name.substringBefore('.')
            if (f.name != "manifest.json" && id !in keep) f.delete()
        }
        manifestFile(ctx).writeText(manifest.toString())
        items
    }

    /** Full sync: refresh the list, report offline watching, download anything new. */
    suspend fun sync(ctx: Context) = lock.withLock {
        val api = Api.from(ctx) ?: return@withLock
        val items = refresh(ctx, api)
        uploadWatched(ctx, api)
        withContext(Dispatchers.IO) {
            for (i in 0 until items.length()) {
                val o = items.getJSONObject(i)
                val id = o.getString("id")
                val thumb = thumbFile(ctx, id)
                if (!thumb.exists()) runCatching { download(api.thumbnail(id), null, thumb) }
                val video = videoFile(ctx, id)
                if (!video.exists()) {
                    download("${api.base}/library/$id", api.token, video)
                    val expected = o.optLong("size")
                    if (expected > 0 && video.length() != expected) {
                        video.delete()
                        throw IOException("Download of $id was incomplete")
                    }
                }
            }
        }
    }

    /** Downloads to a .part file first, and picks up where it left off if interrupted. */
    private fun download(url: String, token: String?, dest: File) {
        val part = File(dest.path + ".part")
        val start = if (part.exists()) part.length() else 0L
        val req = Request.Builder().url(url).apply {
            if (token != null) header("Authorization", "Bearer $token")
            if (start > 0) header("Range", "bytes=$start-")
        }.build()
        Api.http.newCall(req).execute().use { res ->
            if (res.code == 416 && start > 0) {
                part.renameTo(dest); return
            }
            if (!res.isSuccessful) throw IOException("Download failed (${res.code})")
            val body = res.body ?: throw IOException("Empty download")
            FileOutputStream(part, res.code == 206).use { out -> body.byteStream().copyTo(out, 256 * 1024) }
        }
        if (!part.renameTo(dest)) throw IOException("Couldn't save $dest")
    }

    // ---- videos watched from the saved library, reported to the parent's activity log

    @Synchronized
    fun recordWatched(ctx: Context, v: Video) {
        val f = watchedFile(ctx)
        val arr = runCatching { JSONArray(f.readText()) }.getOrDefault(JSONArray())
        arr.put(JSONObject().put("id", v.id).put("title", v.title).put("channel", v.channel)
            .put("ts", System.currentTimeMillis() / 1000.0))
        f.writeText(arr.toString())
    }

    suspend fun uploadWatched(ctx: Context, api: Api) {
        val f = watchedFile(ctx)
        val arr = synchronized(this) { runCatching { JSONArray(f.readText()) }.getOrNull() } ?: return
        if (arr.length() == 0) return
        api.reportWatched(arr)
        synchronized(this) {
            // Keep anything recorded while we were uploading.
            val now = runCatching { JSONArray(f.readText()) }.getOrDefault(JSONArray())
            val rest = JSONArray()
            for (i in arr.length() until now.length()) rest.put(now.get(i))
            f.writeText(rest.toString())
        }
    }

    // ---- scheduling

    private val wifi = Constraints.Builder().setRequiredNetworkType(NetworkType.UNMETERED).build()
    const val SYNC_PERIODIC = "library-sync"
    const val SYNC_NOW = "library-sync-now"

    /** Check every hour while on Wi-Fi, even when the app is closed. */
    fun schedule(ctx: Context) {
        val work = PeriodicWorkRequestBuilder<SyncWorker>(1, TimeUnit.HOURS).setConstraints(wifi).build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(SYNC_PERIODIC, ExistingPeriodicWorkPolicy.KEEP, work)
    }

    /** Sync as soon as possible (on Wi-Fi). */
    fun syncSoon(ctx: Context) {
        val work = OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(wifi).build()
        WorkManager.getInstance(ctx).enqueueUniqueWork(SYNC_NOW, ExistingWorkPolicy.KEEP, work)
    }
}

class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = try {
        Library.sync(applicationContext)
        Result.success()
    } catch (e: Exception) {
        if (runAttemptCount < 5) Result.retry() else Result.failure()
    }
}
