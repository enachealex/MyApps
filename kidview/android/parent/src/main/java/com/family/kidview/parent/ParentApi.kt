package com.family.kidview.parent

import android.app.Application
import android.content.Context
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.Calendar
import java.util.concurrent.TimeUnit

class ApiException(message: String, val code: Int = 0) : Exception(message)

/** Talks to the KidView server with a signed-in parent's token. Uses the same API as the PC dashboard. */
class ParentApi(val base: String, val token: String?) {
    companion object {
        val http: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()
        private val JSON = "application/json".toMediaType()

        fun normalize(input: String): String {
            var s = input.trim().trimEnd('/')
            if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://$s"
            if (!s.substringAfter("://").contains(':')) s = "$s:8765"
            return s
        }
    }

    private suspend fun send(request: Request): String = withContext(Dispatchers.IO) {
        try {
            http.newCall(request).execute().use { res ->
                val body = res.body?.string().orEmpty()
                if (!res.isSuccessful) {
                    val detail = runCatching { JSONObject(body).optString("detail") }.getOrNull()
                    throw ApiException(detail?.takeIf { it.isNotBlank() } ?: "Something went wrong (${res.code})", res.code)
                }
                body
            }
        } catch (e: IOException) {
            throw ApiException("Can't reach the KidView server. Are you on home Wi-Fi (or Tailscale), and is the server running?")
        } catch (e: IllegalArgumentException) {
            throw ApiException("That server address doesn't look right.")
        }
    }

    private fun request(path: String, query: Map<String, String> = emptyMap()): Request.Builder {
        val url = (base + path).toHttpUrl().newBuilder().apply { query.forEach { (k, v) -> addQueryParameter(k, v) } }.build()
        return Request.Builder().url(url).apply { if (token != null) header("Authorization", "Bearer $token") }
    }

    suspend fun get(path: String, query: Map<String, String> = emptyMap()) = JSONObject(send(request(path, query).build()))
    suspend fun getArray(path: String, query: Map<String, String> = emptyMap()) = JSONArray(send(request(path, query).build()))
    suspend fun post(path: String, body: JSONObject = JSONObject()) =
        JSONObject(send(request(path).header("X-KidView-Admin", "1").post(body.toString().toRequestBody(JSON)).build()))

    fun thumbnail(id: String) = "$base/thumb/$id?t=$token"
}

class Session(context: Context) {
    private val sp = context.getSharedPreferences("parent", Context.MODE_PRIVATE)
    var server: String?
        get() = sp.getString("server", null)
        set(v) = sp.edit().putString("server", v).apply()
    var token: String?
        get() = sp.getString("token", null)
        set(v) = sp.edit().putString("token", v).apply()
    var name: String?
        get() = sp.getString("name", null)
        set(v) = sp.edit().putString("name", v).apply()
    var device: String?
        get() = sp.getString("device", null)
        set(v) = sp.edit().putString("device", v).apply()
}

// ---- small JSON helpers

fun JSONArray.objects(): List<JSONObject> = List(length()) { getJSONObject(it) }
fun JSONArray.strings(): List<String> = List(length()) { getString(it) }
fun JSONObject.str(key: String): String = if (isNull(key)) "" else optString(key, "")
fun JSONObject.longOrNull(key: String): Long? = if (isNull(key) || !has(key)) null else optDouble(key).toLong()
fun jsonOf(vararg pairs: Pair<String, Any?>): JSONObject = JSONObject().apply { pairs.forEach { (k, v) -> put(k, v ?: JSONObject.NULL) } }

// ---- app state

enum class Tab(val title: String, val icon: Int) {
    Watching("Watching", R.drawable.ic_clock),
    Search("Search", R.drawable.ic_search),
    Activity("Activity", R.drawable.ic_list),
    Kids("Kids", R.drawable.ic_person),
    Rules("Rules", R.drawable.ic_shield),
}

/** Filters for the "Everyone" activity list. */
data class ActivityFilter(
    val who: String = "",        // "" = everyone, "p:<parent name>" = changes by that parent
    val kind: String = "",       // "", watch, saved, search, blocked, change
    val range: String = "week",  // today, 24h, week, all
    val text: String = "",
)

class ParentViewModel(app: Application) : AndroidViewModel(app) {
    private val session = Session(app)

    var api by mutableStateOf(session.token?.let { t -> session.server?.let { ParentApi(it, t) } })
        private set
    val name get() = session.name.orEmpty()
    val device get() = session.device.orEmpty()
    val server get() = session.server?.removePrefix("http://").orEmpty()

    var tab by mutableStateOf(Tab.Watching)
    var showSettings by mutableStateOf(false)
    var state by mutableStateOf<JSONObject?>(null)
    var library by mutableStateOf<JSONObject?>(null)
    var snack by mutableStateOf<String?>(null)
    var offline by mutableStateOf<String?>(null)

    // Search tab, kept here so it survives switching tabs
    var searchQuery by mutableStateOf("")
    var searchResult by mutableStateOf<JSONObject?>(null)
    var searching by mutableStateOf(false)

    // Kids tab: null = everyone (the full activity log), otherwise one child's device id
    var kidSel by mutableStateOf<String?>(null)
    var kidTab by mutableStateOf("recommended")
    var libCount by mutableStateOf(5)
    var updateCheck by mutableStateOf(0)
    /** What the server's own update check found during Settings → Check for updates. */
    private var serverChecked: String? = null
    var kidData by mutableStateOf<JSONObject?>(null)
    var kidActivity by mutableStateOf(JSONArray())
    var kidRec by mutableStateOf<JSONObject?>(null)
    var blockForKidOnly by mutableStateOf(true)
    var filter by mutableStateOf(ActivityFilter())
    /** Set from a child's page to open the schedule editor pre-set for that child. */
    var pendingSchedule by mutableStateOf<JSONObject?>(null)
    var activity by mutableStateOf(JSONArray())
    private var activityJob: Job? = null

    val rules: JSONObject get() = state?.optJSONObject("rules") ?: JSONObject()
    val watching: JSONObject get() = state?.optJSONObject("watching") ?: JSONObject()
    val devices: List<JSONObject> get() = state?.optJSONArray("devices")?.objects().orEmpty()
    fun deviceName(id: String) = devices.firstOrNull { it.str("id") == id }?.str("name") ?: "a removed device"
    val kidName get() = kidData?.optJSONObject("device")?.str("name") ?: kidSel?.let { deviceName(it) }.orEmpty()

    // ---- sign in / out

    suspend fun signIn(server: String, name: String, pin: String): String? {
        val base = ParentApi.normalize(server)
        val device = Build.MODEL ?: "Phone"
        return try {
            val r = ParentApi(base, null).post("/parent/api/login", jsonOf("name" to name.trim(), "pin" to pin, "device" to device))
            session.server = base; session.token = r.getString("token")
            session.name = r.getJSONObject("parent").str("name"); session.device = device
            api = ParentApi(base, session.token)
            refresh()
            null
        } catch (e: ApiException) {
            e.message
        }
    }

    fun signOut() {
        val a = api
        viewModelScope.launch { runCatching { a?.post("/parent/api/logout") } }
        session.token = null
        api = null; state = null; library = null; activity = JSONArray(); searchResult = null
        kidSel = null; kidData = null; kidRec = null
        tab = Tab.Watching; showSettings = false
    }

    val savedServer get() = session.server?.removePrefix("http://").orEmpty()
    val savedName get() = session.name.orEmpty()

    // ---- loading

    private var rulesRev: String? = null

    fun refresh() {
        val a = api ?: return
        viewModelScope.launch {
            try {
                state = a.get("/admin/api/state")
                // Rules changed (here, on the dashboard, or by another parent): refresh results on screen.
                val rev = state?.optString("rules_rev")
                if (rulesRev != null && rev != rulesRev) {
                    if (searchResult != null && searchQuery.isNotBlank()) search(searchQuery, quiet = true)
                    if (kidSel != null) kidRec = null
                }
                rulesRev = rev
                if (tab == Tab.Activity) loadActivity()
                if (tab == Tab.Kids) { if (kidSel == null) library = a.get("/admin/api/library") else loadKid() }
                offline = null
            } catch (e: ApiException) {
                if (e.code == 401) { snack = "Please sign in again"; signOut() } else offline = e.message
            }
        }
    }

    fun loadLibrary() {
        val a = api ?: return
        viewModelScope.launch { runCatching { library = a.get("/admin/api/library") } }
    }

    /** The "Everyone" activity list, with the current filters. */
    fun loadActivity(debounce: Boolean = false) {
        val a = api ?: return
        activityJob?.cancel()
        activityJob = viewModelScope.launch {
            if (debounce) delay(350)
            val f = filter
            val now = System.currentTimeMillis() / 1000
            val since = when (f.range) {
                "today" -> Calendar.getInstance().apply {
                    set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0)
                }.timeInMillis / 1000
                "24h" -> now - 86_400
                "all" -> 0
                else -> now - 7 * 86_400
            }
            val q = buildMap {
                put("limit", "500"); put("since", since.toString())
                if (f.kind.isNotEmpty()) put("kind", f.kind)
                if (f.who.startsWith("p:")) put("who", f.who.drop(2))
                if (f.who.startsWith("d:")) put("device", f.who.drop(2))
                if (f.text.isNotBlank()) put("q", f.text.trim())
            }
            runCatching { activity = a.getArray("/admin/api/activity", q) }
        }
    }

    fun updateFilter(f: ActivityFilter, debounce: Boolean = false) { filter = f; loadActivity(debounce) }

    fun selectKid(id: String?) {
        if (id != kidSel) { kidData = null; kidRec = null; kidActivity = JSONArray() }
        kidSel = id
        if (id == null) loadLibrary() else loadKid()
    }

    /** From a child's page: open the Activity tab filtered to that child. */
    fun showActivityFor(deviceId: String) {
        filter = ActivityFilter(who = "d:$deviceId")
        tab = Tab.Activity
        loadActivity()
    }

    fun loadKid() {
        val a = api ?: return
        val id = kidSel ?: return
        viewModelScope.launch {
            try {
                val data = a.get("/admin/api/devices/$id")
                if (id == kidSel) kidData = data
                if (kidTab == "recommended" && kidRec == null) loadKidRec()
            } catch (e: ApiException) {
                if (e.code == 404) { snack = "That device isn't set up any more"; kidSel = null } else snack = e.message
            }
        }
    }

    fun loadKidRec() {
        val a = api ?: return
        val id = kidSel ?: return
        viewModelScope.launch { runCatching { a.get("/admin/api/devices/$id/recommended") }.onSuccess { if (id == kidSel) kidRec = it } }
    }

    /** Runs a change, shows [done] (or the error), and refreshes. */
    fun act(done: String? = null, block: suspend (ParentApi) -> Unit) {
        val a = api ?: return
        viewModelScope.launch {
            try {
                block(a)
                if (done != null) snack = done
            } catch (e: ApiException) {
                snack = e.message
                if (e.code == 401) signOut()
            }
            refresh()
        }
    }

    // ---- updates
    /** Settings → Check for updates: asks about the server now, then the app (the prompt shows if there's one). */
    fun checkForUpdates() {
        val a = api ?: return
        viewModelScope.launch {
            serverChecked = try {
                val r = a.post("/admin/api/update/check")
                r.optJSONObject("update")?.optString("version")?.ifEmpty { null } ?: ""
            } catch (e: ApiException) { snack = e.message; null }
            refresh()
            updateCheck++
        }
    }

    /** Called when the app itself has nothing new. */
    fun appUpToDate() {
        snack = when (val s = serverChecked) {
            null -> "The app is up to date"
            "" -> "Everything is up to date"
            else -> "The app is up to date. Server $s is ready to install."
        }
        serverChecked = null
    }

    fun updateServer() = act("Updating the server. It'll be back in about a minute.") {
        it.post("/admin/api/update/install")
    }

    // ---- changes

    fun setWatching(on: Boolean, minutes: Int? = null) = act(if (on) "Watching is on" else "Watching is off") {
        state = it.post("/admin/api/watching", jsonOf("on" to on, "minutes" to minutes))
    }

    fun resumeSchedule() = act("Back on the schedule") { state = it.post("/admin/api/watching/resume") }

    fun saveSchedule(s: JSONObject, done: String = "Schedule saved") = act(done) {
        state = it.post("/admin/api/schedules/save", jsonOf("schedule" to s))
    }

    fun deleteSchedule(id: String) = act("Schedule deleted") {
        state = it.post("/admin/api/schedules/delete", jsonOf("id" to id))
    }

    fun setRule(key: String, value: Any, done: String? = "Saved") = act(done) {
        it.post("/admin/api/rules", jsonOf(key to value))
    }

    fun setTopic(name: String, block: Boolean) = act(if (block) "$name is blocked" else "$name is allowed") {
        it.post("/admin/api/topic", jsonOf("name" to name, "block" to block))
    }

    /** Adds to a family list, or with [device], to just that child's restrictions. */
    fun listAdd(key: String, item: JSONObject, done: String, device: String? = null) = act(done) {
        it.post("/admin/api/list/add", jsonOf("key" to key, "item" to item).apply { if (device != null) put("device", device) })
        if (device != null) kidRec = null
    }

    fun listRemove(key: String, id: String, done: String = "Removed", device: String? = null) = act(done) {
        it.post("/admin/api/list/remove", jsonOf("key" to key, "id" to id).apply { if (device != null) put("device", device) })
    }

    /** From the Kids tab: block for just this child or for everyone, depending on the switch. */
    fun blockFromKids(key: String, item: JSONObject, label: String) {
        val only = if (kidSel != null && blockForKidOnly && key != "approved_videos") kidSel else null
        listAdd(key, item, if (only != null) "$label for $kidName" else label, only)
        kidRec = null
    }

    /** Looks up a pasted link (channel or video) and adds it to a list. */
    fun addByLink(kind: String, text: String, key: String, device: String? = null, extra: JSONObject.() -> Unit = {}) = act {
        val found = it.post("/admin/api/lookup/$kind", jsonOf("text" to text))
        val item = if (kind == "channel") jsonOf("id" to found.str("id"), "name" to found.str("name"))
        else jsonOf("id" to found.str("id"), "title" to found.str("title"), "channel" to found.str("channel"),
            "channel_id" to found.str("channel_id"), "duration" to found.opt("duration"))
        item.extra()
        it.post("/admin/api/list/add", jsonOf("key" to key, "item" to item).apply { if (device != null) put("device", device) })
        snack = "Added " + (found.str("name").ifBlank { found.str("title") })
    }

    fun setKidLimit(key: String, value: Any?) {
        val id = kidSel ?: return
        act("Saved for $kidName") { it.post("/admin/api/devices/$id/limits", jsonOf(key to value)) }
    }

    /** [quiet] = update the results in place (after a rules change) without the loading spinner. */
    fun search(q: String, quiet: Boolean = false) {
        val a = api ?: return
        if (q.isBlank()) return
        viewModelScope.launch {
            if (!quiet) searching = true
            try {
                searchResult = a.get("/admin/api/preview", mapOf("q" to q.trim()))
            } catch (e: ApiException) {
                if (!quiet) snack = e.message
            } finally {
                searching = false
            }
        }
    }

    // ---- set-up links (QR codes)

    /** Server address from the parent-app QR code or link, for the sign-in screen. */
    var pendingServer by mutableStateOf<String?>(null)

    /** kidview://pair?server=...&code=... for setting up a kid's device from this phone's screen. */
    /** Same as the dashboard's kid QR code: the server's /add page, which installs and connects KidView. */
    fun kidPairLink(addr: String): String =
        "http://$addr/add?code=" + android.net.Uri.encode(state?.str("family_code").orEmpty())

    fun syncLibrary() = act("Checking for new videos") { it.post("/admin/api/library/sync") }
    fun removeDevice(id: String) = act("Device removed") { it.post("/admin/api/devices/remove", jsonOf("id" to id)) }
    fun renameDevice(id: String, name: String) = act("Renamed to $name") {
        it.post("/admin/api/devices/rename", jsonOf("id" to id, "name" to name))
    }
    fun newFamilyCode() = act("New family code made") { it.post("/admin/api/code/new") }
    fun addParent(name: String, pin: String) = act("Added $name") { it.post("/admin/api/parents/add", jsonOf("name" to name, "pin" to pin)) }
    fun removeParent(id: String) = act("Account removed") { it.post("/admin/api/parents/remove", jsonOf("id" to id)) }

    suspend fun changePin(old: String, new: String): String? = try {
        api?.post("/parent/api/pin", jsonOf("old" to old, "new" to new)); null
    } catch (e: ApiException) {
        e.message
    }
}
