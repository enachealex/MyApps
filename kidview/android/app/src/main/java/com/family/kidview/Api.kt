package com.family.kidview

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

data class Video(val id: String, val title: String, val channel: String, val duration: Int?)
data class Home(
    val paused: Boolean,
    val searchEnabled: Boolean,
    val picks: List<Video>,
    val backAt: Long? = null,
    val raw: JSONObject = JSONObject(),
)
data class SearchResult(val paused: Boolean, val blocked: Boolean, val results: List<Video>)
data class Play(val allowed: Boolean, val paused: Boolean, val title: String, val streams: List<String>)

class ApiException(message: String, val code: Int = 0) : Exception(message)

/** Talks to the KidView server on the home computer. The app never talks to YouTube directly. */
class Api(val base: String, val token: String?) {

    companion object {
        const val DEFAULT_PORT = 8765
        val http: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS) // the server may wait a few seconds before a video is ready
            .build()

        /** "192.168.0.20" -> "http://192.168.0.20:8765" */
        fun normalize(input: String): String {
            var s = input.trim().trimEnd('/')
            if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://$s"
            val hostPart = s.substringAfter("://")
            if (!hostPart.contains(':')) s = "$s:$DEFAULT_PORT"
            return s
        }

        fun from(context: Context): Api? {
            val p = Prefs(context)
            val server = p.server ?: return null
            val token = p.token ?: return null
            return Api(server, token)
        }
    }

    private suspend fun call(request: Request): JSONObject = withContext(Dispatchers.IO) {
        try {
            http.newCall(request).execute().use { res ->
                val body = res.body?.string().orEmpty()
                if (!res.isSuccessful) {
                    val detail = runCatching { JSONObject(body).optString("detail") }.getOrNull()
                    throw ApiException(detail?.takeIf { it.isNotBlank() } ?: "Something went wrong (${res.code})", res.code)
                }
                JSONObject(body)
            }
        } catch (e: IOException) {
            throw ApiException("Can't reach the home computer. Is this device on home Wi-Fi, and is the KidView server running?")
        } catch (e: IllegalArgumentException) {
            throw ApiException("That server address doesn't look right.")
        }
    }

    private fun get(path: String, query: Map<String, String> = emptyMap()): Request {
        val url = (base + path).toHttpUrl().newBuilder().apply {
            query.forEach { (k, v) -> addQueryParameter(k, v) }
        }.build()
        return Request.Builder().url(url).header("Authorization", "Bearer $token").build()
    }

    private fun videos(arr: JSONArray?): List<Video> = buildList {
        if (arr == null) return@buildList
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            add(Video(o.getString("id"), o.optString("title"), o.optString("channel"),
                if (o.isNull("duration")) null else o.optInt("duration")))
        }
    }

    suspend fun pair(code: String, name: String): String {
        val json = JSONObject().put("code", code).put("name", name).toString()
        val req = Request.Builder().url("$base/api/pair")
            .post(json.toRequestBody("application/json".toMediaType())).build()
        return call(req).getString("token")
    }

    suspend fun home(): Home {
        val o = call(get("/api/home"))
        return Home(o.optBoolean("paused"), o.optBoolean("search_enabled", true), videos(o.optJSONArray("picks")),
            if (o.isNull("back_at")) null else o.optLong("back_at"), o)
    }

    suspend fun search(q: String): SearchResult {
        val o = call(get("/api/search", mapOf("q" to q)))
        return SearchResult(o.optBoolean("paused"), o.optBoolean("blocked"), videos(o.optJSONArray("results")))
    }

    suspend fun play(id: String): Play {
        val o = call(get("/api/play/$id"))
        val streams = o.optJSONObject("streams")
        val urls = buildList { streams?.keys()?.forEach { add(base + streams.getString(it)) } }
        return Play(o.optBoolean("allowed"), o.optBoolean("paused"), o.optString("title"), urls)
    }

    /** Home-screen sections, e.g. "Recommended for you ⭐" or the funny + educational starter mix. */
    suspend fun recommended(): List<Pair<String, List<Video>>> {
        val o = call(get("/api/recommended"))
        val sections = o.optJSONArray("sections") ?: return emptyList()
        return List(sections.length()) { i ->
            val s = sections.getJSONObject(i)
            s.optString("title") to videos(s.optJSONArray("videos"))
        }.filter { it.second.isNotEmpty() }
    }

    suspend fun library(): JSONObject = call(get("/api/library"))

    suspend fun reportWatched(events: JSONArray) {
        val json = JSONObject().put("events", events).toString()
        call(Request.Builder().url("$base/api/watched").header("Authorization", "Bearer $token")
            .post(json.toRequestBody("application/json".toMediaType())).build())
    }

    fun thumbnail(id: String) = "$base/thumb/$id?t=$token"
}

class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("kidview", Context.MODE_PRIVATE)
    var server: String?
        get() = sp.getString("server", null)
        set(v) = sp.edit().putString("server", v).apply()
    var token: String?
        get() = sp.getString("token", null)
        set(v) = sp.edit().putString("token", v).apply()
    var deviceName: String?
        get() = sp.getString("name", null)
        set(v) = sp.edit().putString("name", v).apply()
    /** Whether watching was turned off the last time we heard from the server (used offline). */
    var lastPaused: Boolean
        get() = sp.getBoolean("paused", false)
        set(v) = sp.edit().putBoolean("paused", v).apply()
    /** Times watching is off over the next week, as JSON [[start, end], ...] in epoch seconds. */
    var offPeriods: String?
        get() = sp.getString("off_periods", null)
        set(v) = sp.edit().putString("off_periods", v).apply()
    var periodsUntil: Long
        get() = sp.getLong("periods_until", 0)
        set(v) = sp.edit().putLong("periods_until", v).apply()
}
