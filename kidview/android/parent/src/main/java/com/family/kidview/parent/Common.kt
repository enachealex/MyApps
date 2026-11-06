package com.family.kidview.parent

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

val Purple = Color(0xFF6C4BF4)
val PurpleDark = Color(0xFF2B2350)
val Ok = Color(0xFF1F8A4C)
val OkSoft = Color(0xFFE3F5EA)
val Bad = Color(0xFFC43D3D)
val BadSoft = Color(0xFFFDE8E8)
val Warn = Color(0xFF8A5A00)
val WarnSoft = Color(0xFFFFF4DC)
val Muted = Color(0xFF667085)

// ---- formatting

private fun midnight(ms: Long): Long = Calendar.getInstance().run {
    timeInMillis = ms
    set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    timeInMillis
}

private fun daysFromToday(ms: Long) = Math.round((midnight(ms) - midnight(System.currentTimeMillis())) / 86_400_000.0)

fun clock(ms: Long): String = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(ms))

/** A future time: "7:00 AM", "tomorrow 7:00 AM", "Sat 9:00 AM". */
fun whenText(ts: Long?): String {
    if (ts == null) return ""
    val ms = ts * 1000
    return when (daysFromToday(ms)) {
        0L -> clock(ms)
        1L -> "tomorrow " + clock(ms)
        else -> SimpleDateFormat("EEE", Locale.getDefault()).format(Date(ms)) + " " + clock(ms)
    }
}

/** A past time: "just now", "12 min ago", "3:10 PM", "Mon 3:10 PM". */
fun agoText(ts: Double): String {
    val ms = (ts * 1000).toLong()
    val secs = (System.currentTimeMillis() - ms) / 1000
    return when {
        secs < 60 -> "just now"
        secs < 3600 -> "${secs / 60} min ago"
        daysFromToday(ms) == 0L -> clock(ms)
        else -> SimpleDateFormat("EEE", Locale.getDefault()).format(Date(ms)) + " " + clock(ms)
    }
}

fun duration(seconds: Int): String {
    val h = seconds / 3600; val m = seconds % 3600 / 60; val s = seconds % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

fun hhmmText(hhmm: String): String {
    val parts = hhmm.split(":")
    if (parts.size != 2) return hhmm
    val c = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, parts[0].toInt()); set(Calendar.MINUTE, parts[1].toInt()) }
    return clock(c.timeInMillis)
}

val DAYS = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

fun daysLabel(days: List<Int>): String {
    val set = days.toSet()
    if (set.size == 7) return "Every day"
    if (set == setOf(0, 1, 2, 3, 4)) return "Weekdays"
    if (set == setOf(5, 6)) return "Weekends"
    val runs = mutableListOf<String>()
    for (d in 0..6) {
        if (d !in set || (d + 6) % 7 in set) continue
        var e = d
        while ((e + 1) % 7 in set && (e + 1) % 7 != d) e = (e + 1) % 7
        runs += when (e) {
            d -> DAYS[d]
            (d + 1) % 7 -> DAYS[d] + ", " + DAYS[e]
            else -> DAYS[d] + "–" + DAYS[e]
        }
    }
    return runs.joinToString(", ")
}

fun scheduleTimes(start: String, end: String): String =
    if (start == end) "All day" else "${hhmmText(start)} – ${hhmmText(end)}" + if (end < start) " (next day)" else ""

fun openOnYouTube(context: Context, id: String) = openLink(context, "https://www.youtube.com/watch?v=$id")

fun openLink(context: Context, url: String) {
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
}

// ---- shared pieces

/** Every tab uses this, so content sits in exactly the same place whichever tab you switch to. */
@Composable
fun TabPage(content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit) {
    androidx.compose.foundation.lazy.LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
        content = content,
    )
}

@Composable
fun Section(
    title: String,
    subtitle: String? = null,
    action: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(title, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                    if (subtitle != null) Text(subtitle, color = Muted, fontSize = 13.sp, lineHeight = 17.sp)
                }
                action?.invoke()
            }
            content()
        }
    }
}

enum class Tone { Ok, Bad, Warn }

@Composable
fun Tag(text: String, tone: Tone) {
    val (fg, bg) = when (tone) { Tone.Ok -> Ok to OkSoft; Tone.Bad -> Bad to BadSoft; Tone.Warn -> Warn to WarnSoft }
    Text(text, color = fg, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
        modifier = Modifier.background(bg, RoundedCornerShape(20.dp)).padding(horizontal = 8.dp, vertical = 2.dp))
}

@Composable
fun Thumb(api: ParentApi?, id: String, width: Int = 112) {
    AsyncImage(
        model = api?.thumbnail(id), contentDescription = null, contentScale = ContentScale.Crop,
        modifier = Modifier.width(width.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(8.dp)).background(Color(0xFFE9E6F2)),
    )
}

/** A text box with a button, for pasting links or adding words. */
@Composable
fun AddRow(placeholder: String, button: String, onAdd: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    val submit = { if (text.isNotBlank()) { onAdd(text.trim()); text = "" } }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = text, onValueChange = { text = it }, modifier = Modifier.weight(1f),
            placeholder = { Text(placeholder, fontSize = 14.sp) }, singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { submit() }),
            shape = RoundedCornerShape(12.dp),
        )
        Button(onClick = submit, shape = RoundedCornerShape(12.dp)) { Text(button) }
    }
}

/** One row in a list with a remove button. */
@Composable
fun ItemRow(
    title: String, subtitle: String?, api: ParentApi? = null, thumbId: String? = null,
    onEdit: (() -> Unit)? = null, onRemove: () -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        if (thumbId != null) Thumb(api, thumbId, 84)
        Column(Modifier.weight(1f)) {
            Text(title, maxLines = 2, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium, fontSize = 14.sp)
            if (!subtitle.isNullOrBlank()) Text(subtitle, color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (onEdit != null) IconButton(onClick = onEdit) { Icon(painterResource(R.drawable.ic_edit), "Rename", tint = Muted) }
        IconButton(onClick = onRemove) { Icon(painterResource(R.drawable.ic_close), "Remove", tint = Muted) }
    }
}

@Composable
fun Empty(text: String) {
    Text(text, color = Muted, fontSize = 14.sp, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp))
}

/** A confirm dialog: shows when [show] isn't null. */
@Composable
fun Confirm(show: String?, confirm: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    if (show == null) return
    AlertDialog(
        onDismissRequest = onDismiss,
        text = { Text(show) },
        confirmButton = { TextButton(onClick = { onConfirm(); onDismiss() }) { Text(confirm, color = Bad) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
