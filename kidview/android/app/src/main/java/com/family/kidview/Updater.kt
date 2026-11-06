package com.family.kidview

import android.app.Activity
import android.app.ActivityOptions
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONObject
import java.io.File

/**
 * App updates for KidView, which isn't installed from the Play Store.
 *
 * The check is silent: it reads latest.json on the KidView website (which only changes when a new
 * version is published) and only asks the parent when there really is a newer version. "Update"
 * downloads it, checks it, and installs it with Android's package installer, so there's no APK file
 * to deal with. Android asks once to allow installs from this app; after that, updates install
 * without extra screens (Android 12+). The app closes to finish and is opened again as usual.
 */
object Updater {
    /** e.g. https://example.com/kidview/ (KIDVIEW_SITE in android/gradle.properties) */
    private val SITE = BuildConfig.UPDATE_SITE
    private const val CHECK_EVERY_MS = 3 * 60 * 60 * 1000L
    const val ACTION_INSTALL_RESULT = "com.family.kidview.INSTALL_RESULT"
    private const val CLOSING = "Installing… KidView closes for a moment to finish. Open it again in a few seconds."

    data class Release(val version: String, val apkUrl: String, val apkName: String, val notes: String, val sha256: String)

    /** Shared with the update dialog: true while downloading/installing, and what to tell the parent. */
    val busy = mutableStateOf(false)
    val status = mutableStateOf<String?>(null)
    private var waitingForPermission: Release? = null
    private val scope = MainScope()

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("updates", Context.MODE_PRIVATE)

    fun currentVersion(ctx: Context): String =
        runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName }.getOrNull() ?: "0"

    private fun parse(v: String) = v.trimStart('v').split('.').map { it.takeWhile(Char::isDigit).toIntOrNull() ?: 0 }

    fun isNewer(latest: String, current: String): Boolean {
        val a = parse(latest); val b = parse(current)
        for (i in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrElse(i) { 0 }; val y = b.getOrElse(i) { 0 }
            if (x != y) return x > y
        }
        return false
    }

    /** A newer published version, or null. Never shows anything itself, and never throws. */
    suspend fun check(ctx: Context, force: Boolean = false): Release? = withContext(Dispatchers.IO) {
        if (SITE.isBlank() || "YOUR-SITE" in SITE) return@withContext null
        val p = prefs(ctx)
        val now = System.currentTimeMillis()
        val latestUrl = SITE.trimEnd('/') + "/latest.json"
        val cached = p.getString("release", null)?.let { runCatching { JSONObject(it) }.getOrNull() }
        val json = if (!force && cached != null && now - p.getLong("checked", 0) < CHECK_EVERY_MS) cached else {
            runCatching {
                val req = Request.Builder().url(latestUrl).header("Cache-Control", "no-cache").build()
                Api.http.newCall(req).execute().use { if (it.isSuccessful) JSONObject(it.body?.string().orEmpty()) else null }
            }.getOrNull()?.also { p.edit().putString("release", it.toString()).putLong("checked", now).apply() }
                ?: return@withContext null
        }
        val version = json.optString("version")
        if (version.isEmpty() || !isNewer(version, currentVersion(ctx))) return@withContext null
        if (!force && p.getString("later", null) == version && now - p.getLong("later_at", 0) < 24 * 3600 * 1000L) return@withContext null
        val path = json.optString("kids_apk").ifEmpty { return@withContext null }
        val url = java.net.URL(java.net.URL(latestUrl), path).toString()
        Release(version, url, path.substringAfterLast('/'), json.optString("notes"),
            json.optJSONObject("sha256")?.optString(path).orEmpty())
    }

    fun later(ctx: Context, r: Release) {
        prefs(ctx).edit().putString("later", r.version).putLong("later_at", System.currentTimeMillis()).apply()
    }

    /** "Update": downloads and installs [r]. [activity] is the app's screen. Progress goes to [busy]/[status]. */
    fun start(activity: Activity, r: Release) {
        busy.value = true
        if (!activity.packageManager.canRequestPackageInstalls()) {
            // Android asks once whether this app may install updates. We carry on when the parent comes back.
            waitingForPermission = r
            status.value = "Turn on \"Allow from this source\", then come back. The update carries on by itself."
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
            return
        }
        status.value = "Downloading…"
        scope.launch {
            val error = install(activity, r)
            if (error != null) { busy.value = false; status.value = error }
            else if (status.value == "Downloading…") status.value = CLOSING
        }
    }

    /** Call from the activity's onResume: continues an update after the parent allowed installs. */
    fun onResume(activity: Activity) {
        val r = waitingForPermission ?: return
        waitingForPermission = null
        if (activity.packageManager.canRequestPackageInstalls()) start(activity, r)
        else { busy.value = false; status.value = "Installs from KidView aren't allowed yet, so the update didn't start." }
    }

    private fun sha256(f: File): String {
        val md = java.security.MessageDigest.getInstance("SHA-256")
        f.inputStream().use { i -> val buf = ByteArray(64 * 1024); while (true) { val n = i.read(buf); if (n < 0) break; md.update(buf, 0, n) } }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /** Downloads, checks and installs [r]. Returns an error message, or null once Android is installing it. */
    private suspend fun install(ctx: Context, r: Release): String? = withContext(Dispatchers.IO) {
        val apk = runCatching {
            val dir = File(ctx.cacheDir, "updates").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
            val out = File(dir, r.apkName)
            Api.http.newCall(Request.Builder().url(r.apkUrl).build()).execute().use { res ->
                if (!res.isSuccessful) error("download failed")
                out.outputStream().use { o -> res.body!!.byteStream().copyTo(o) }
            }
            if (r.sha256.isNotEmpty() && sha256(out) != r.sha256.lowercase()) { out.delete(); error("damaged download") }
            out
        }.getOrNull() ?: return@withContext "Couldn't download the update. Check the internet connection and try again."
        val error = runCatching { commit(ctx, apk); null }.getOrElse { "Couldn't install the update (${it.message})." }
        apk.delete()
        error
    }

    private fun commit(ctx: Context, apk: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(ctx.packageName)
            setSize(apk.length())
            // An app may update itself without asking (Android 12+). Older Android shows one confirmation.
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("update.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            // Android reports back to the app's screen (a confirmation it needs, or an error).
            // Newer Android only delivers that while the app is on screen, and only if the app allows it.
            val result = Intent(ctx, MainActivity::class.java).setAction(ACTION_INSTALL_RESULT)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            val options = if (Build.VERSION.SDK_INT >= 34) ActivityOptions.makeBasic().apply {
                setPendingIntentCreatorBackgroundActivityStartMode(
                    if (Build.VERSION.SDK_INT >= 36) ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_IF_VISIBLE
                    else @Suppress("DEPRECATION") ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED)
            }.toBundle() else null
            val pending = PendingIntent.getActivity(ctx, id, result,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE, options)
            session.commit(pending.intentSender)
        }
    }

    /** The package installer's answer, delivered to the activity. Returns true if [intent] was one. */
    fun onInstallResult(activity: Activity, intent: Intent?): Boolean {
        if (intent?.action != ACTION_INSTALL_RESULT) return false
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                    else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
                if (confirm != null) {
                    status.value = CLOSING
                    activity.startActivity(confirm)
                }
            }
            PackageInstaller.STATUS_SUCCESS -> { busy.value = false; status.value = null }
            PackageInstaller.STATUS_FAILURE_ABORTED -> { busy.value = false; status.value = "The update was cancelled." }
            else -> {
                busy.value = false
                status.value = "The update didn't install (${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "unknown error"})."
            }
        }
        return true
    }
}

/**
 * Asks "A new version is ready" only when there is one; the check itself is silent.
 * Bump [trigger] to check right now (Settings → Check for updates); [onUpToDate] runs if there's nothing new.
 */
@Composable
fun UpdatePrompt(trigger: Int = 0, onUpToDate: () -> Unit = {}) {
    val ctx = LocalContext.current
    var release by remember { mutableStateOf<Updater.Release?>(null) }
    val busy by Updater.busy
    val status by Updater.status
    LaunchedEffect(trigger) {
        val r = Updater.check(ctx, force = trigger > 0)
        if (r != null) { release = r; if (!Updater.busy.value) Updater.status.value = null }
        else if (trigger > 0) onUpToDate()
    }
    val r = release ?: return
    AlertDialog(
        onDismissRequest = { if (!busy) { Updater.later(ctx, r); release = null } },
        title = { Text("A new version of KidView is ready") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Version ${r.version} (you have ${Updater.currentVersion(ctx)}).")
                if (r.notes.isNotBlank()) Text(r.notes.take(700), style = MaterialTheme.typography.bodySmall)
                if (busy) LinearProgressIndicator()
                status?.let { Text(it) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy, onClick = { (ctx as? Activity)?.let { Updater.start(it, r) } }) {
                Text(if (status != null && !busy) "Try again" else "Update")
            }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = { Updater.later(ctx, r); release = null }) { Text("Later") } },
    )
}
